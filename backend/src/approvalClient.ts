import type { ApprovalOperation } from './approvalStore'
import type { Env } from './types'

function stub(env: Env): DurableObjectStub {
  if (!env.APPROVALS) throw new Error('Approval storage is not configured')
  return env.APPROVALS.get(env.APPROVALS.idFromName('bestcode-approvals-v1'))
}

async function request<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await stub(env).fetch(`https://approval-store${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Approval store error ${response.status}`)
  return payload
}

export async function createApproval(env: Env, operation: ApprovalOperation): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, '/operations', {
    method: 'POST',
    body: JSON.stringify(operation),
  })
}

export async function getApproval(env: Env, operationId: string): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}`)
}

export async function listApprovals(
  env: Env,
  filters: { status?: string; projectId?: string; limit?: number } = {},
): Promise<{ items: ApprovalOperation[]; count: number; total: number }> {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.projectId) query.set('project_id', filters.projectId)
  if (filters.limit) query.set('limit', String(filters.limit))
  return request(env, `/operations?${query.toString()}`)
}

export async function decideApproval(
  env: Env,
  operationId: string,
  decision: 'approved' | 'rejected',
  actor = 'bestcode-user',
): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, actor }),
  })
}

export async function cancelApproval(env: Env, operationId: string): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/cancel`, {
    method: 'POST',
  })
}

export async function markApprovalCommitted(
  env: Env,
  operationId: string,
  commitSha: string,
  commitUrl?: string,
): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/committed`, {
    method: 'POST',
    body: JSON.stringify({ commit_sha: commitSha, commit_url: commitUrl }),
  })
}
