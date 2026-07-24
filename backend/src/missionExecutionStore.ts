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
  return request(env, input.mission_id, { method: 'POST', body: JSON.stringify(input) })
}
