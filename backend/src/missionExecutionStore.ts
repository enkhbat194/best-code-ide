import type { ExecutionCommand, MissionExecutionState } from './missionExecutionService'
import type { Env } from './types'

function stub(env: Env): DurableObjectStub {
  if (!env.APPROVALS) throw new Error('Mission execution storage is not configured')
  return env.APPROVALS.get(env.APPROVALS.idFromName('bestcode-approvals-v1'))
}

async function request<T>(env: Env, missionId: string, init: RequestInit = {}): Promise<T> {
  const suffix = init.method === 'POST' ? '/command' : ''
  const response = await stub(env).fetch(`https://approval-store/mission-executions/${encodeURIComponent(missionId)}${suffix}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Mission execution store error ${response.status}`)
  return body
}

export function getMissionExecution(env: Env, missionId: string): Promise<MissionExecutionState> {
  return request(env, missionId)
}

export function commandMissionExecution(
  env: Env,
  input: ExecutionCommand,
): Promise<{ state: MissionExecutionState; replayed: boolean }> {
  return request<{ state: MissionExecutionState; replayed: boolean }>(
    env,
    input.mission_id,
    { method: 'POST', body: JSON.stringify(input) },
  ).then(async (result) => {
    if (![
      'mission_task_result_submit',
      'mission_task_block',
      'mission_task_cancel',
      'mission_task_lease_release',
      'mission_execution_reject_gate',
      'mission_execution_cancel',
    ].includes(input.command)) return result
    try {
      const { revokeAllBoundedWriteCredentials } = await import('./boundedWriteCredentials')
      const revoked = await revokeAllBoundedWriteCredentials(env, {
        project_id: input.project_id,
        mission_id: input.mission_id,
        ...(typeof input.args.task_id === 'string' ? { task_id: input.args.task_id } : {}),
      })
      if (revoked.length) {
        const { persistSecurityAudit } = await import('./securityAudit')
        await persistSecurityAudit(env, 'bounded_write_terminal_cleanup', {
          identity: 'unknown',
          project_id: input.project_id,
          mission_id: input.mission_id,
          task_id: typeof input.args.task_id === 'string' ? input.args.task_id : null,
          execution_command: input.command,
          revoked_credential_ids: revoked.map((item) => item.credential_id),
        })
      }
    } catch {
      // Mission state remains authoritative and already makes every mutation fail closed.
    }
    return result
  })
}
