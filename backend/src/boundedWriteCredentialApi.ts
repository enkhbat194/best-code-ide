import {
  boundedWriteCredentialGet,
  boundedWriteCredentialList,
  boundedWriteCredentialRevoke,
  issueApprovedBoundedWriteCredential,
  revokeAllBoundedWriteCredentials,
  type IssueBoundedWriteCredentialInput,
} from './boundedWriteCredentials'
import { getMissionExecution } from './missionExecutionStore'
import { persistSecurityAudit } from './securityAudit'
import type { RequestPrincipal } from './subscriptionCredentialTypes'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function ownerOnly(principal: RequestPrincipal): Response | null {
  return principal.kind === 'owner' ? null : noStore(jsonError('Unauthorized', 401))
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function issueInput(body: Record<string, any>): IssueBoundedWriteCredentialInput {
  return {
    project_id: string(body.project_id),
    mission_id: string(body.mission_id),
    execution_plan_id: string(body.execution_plan_id),
    task_id: string(body.task_id),
    attempt_id: string(body.attempt_id),
    lease_id: string(body.lease_id),
    fencing_token: Number(body.fencing_token),
    agent_id: string(body.agent_id),
    provider: string(body.provider),
    branch: string(body.branch),
    base_sha: string(body.base_sha),
    allowed_tools: stringList(body.allowed_tools),
    allowed_paths: stringList(body.allowed_paths),
    denied_paths: body.denied_paths === undefined ? undefined : stringList(body.denied_paths),
    expires_in_seconds: body.expires_in_seconds === undefined ? undefined : Number(body.expires_in_seconds),
    limits: body.limits,
    idempotency_namespace: string(body.idempotency_namespace),
    approval_record_id: string(body.approval_record_id),
  }
}

export async function handleBoundedWriteCredentialApi(
  req: Request,
  env: Env,
  url: URL,
  principal: RequestPrincipal,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/bounded-write/')) return null
  const denied = ownerOnly(principal)
  if (denied) return denied
  try {
    if (url.pathname === '/api/bounded-write/credentials') {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => null)
        if (!body || typeof body !== 'object' || Array.isArray(body)) return noStore(jsonError('Invalid JSON body', 400))
        const issued = await issueApprovedBoundedWriteCredential(env, issueInput(body as Record<string, any>))
        await persistSecurityAudit(env, 'bounded_write_credential_issued', {
          identity: 'owner',
          credential_id: issued.credential.credential_id,
          project_id: issued.credential.project_id,
          mission_id: issued.credential.mission_id,
          task_id: issued.credential.task_id,
          attempt_id: issued.credential.attempt_id,
          lease_id: issued.credential.lease_id,
          fencing_token: issued.credential.fencing_token,
          agent_id: issued.credential.agent_id,
          provider: issued.credential.provider,
          branch: issued.credential.branch,
          scope_hash: issued.credential.scope_hash,
          expires_at: issued.credential.expires_at,
        })
        return noStore(jsonResponse({
          credential: issued.credential,
          secret: issued.secret,
          secret_display: 'one-time',
          connector_name: 'BestCode Bounded Write',
        }, 201))
      }
      if (req.method === 'GET') {
        const items = await boundedWriteCredentialList(env, {
          project_id: url.searchParams.get('project_id') ?? undefined,
          mission_id: url.searchParams.get('mission_id') ?? undefined,
          task_id: url.searchParams.get('task_id') ?? undefined,
        })
        return noStore(jsonResponse({ items, count: items.length }))
      }
      return noStore(jsonError('Method not allowed', 405))
    }

    const credential = url.pathname.match(/^\/api\/bounded-write\/credentials\/([a-f0-9-]{36})(?:\/(revoke))?$/i)
    if (credential) {
      if (req.method === 'GET' && !credential[2]) {
        return noStore(jsonResponse({ credential: await boundedWriteCredentialGet(env, credential[1]) }))
      }
      if (req.method === 'POST' && credential[2] === 'revoke') {
        const revoked = await boundedWriteCredentialRevoke(env, credential[1])
        await persistSecurityAudit(env, 'bounded_write_credential_revoked', {
          identity: 'owner',
          credential_id: revoked.credential_id,
          project_id: revoked.project_id,
          mission_id: revoked.mission_id,
          task_id: revoked.task_id,
          revoked_at: revoked.revoked_at,
        })
        return noStore(jsonResponse({ credential: revoked }))
      }
      return noStore(jsonError('Method not allowed', 405))
    }

    const task = url.pathname.match(/^\/api\/bounded-write\/tasks\/([a-f0-9-]{16,64})\/(status|revoke-all)$/i)
    if (task) {
      const taskId = task[1]
      const projectId = url.searchParams.get('project_id') ?? ''
      const missionId = url.searchParams.get('mission_id') ?? ''
      if (!projectId || !missionId) return noStore(jsonError('project_id and mission_id are required', 400))
      const state = await getMissionExecution(env, missionId)
      if (state.project_id !== projectId || !state.tasks.some((item) => item.task_id === taskId)) {
        return noStore(jsonError('Task scope mismatch', 409))
      }
      if (task[2] === 'status' && req.method === 'GET') {
        const credentials = await boundedWriteCredentialList(env, {
          project_id: projectId,
          mission_id: missionId,
          task_id: taskId,
        })
        const executionTask = state.tasks.find((item) => item.task_id === taskId)
        return noStore(jsonResponse({
          task: executionTask,
          approval: state.approval_gates[taskId] ?? null,
          active_lease: state.leases.find((item) => item.task_id === taskId && !item.released_at) ?? null,
          credentials,
        }))
      }
      if (task[2] === 'revoke-all' && req.method === 'POST') {
        const revoked = await revokeAllBoundedWriteCredentials(env, {
          project_id: projectId,
          mission_id: missionId,
          task_id: taskId,
        })
        await persistSecurityAudit(env, 'bounded_write_task_emergency_revoke', {
          identity: 'owner',
          project_id: projectId,
          mission_id: missionId,
          task_id: taskId,
          revoked_credential_ids: revoked.map((item) => item.credential_id),
        })
        return noStore(jsonResponse({ revoked, count: revoked.length }))
      }
      return noStore(jsonError('Method not allowed', 405))
    }
    return noStore(jsonError('Not found', 404))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /not found/i.test(message) ? 404 : /required|invalid|must be|between/i.test(message) ? 400 : 409
    await persistSecurityAudit(env, 'bounded_write_credential_denied', {
      identity: 'owner',
      denial_code: message,
      path: url.pathname,
    }).catch(() => undefined)
    return noStore(jsonError(message, status))
  }
}
