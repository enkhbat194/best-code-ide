import type { ApprovalOperation, TaskRecord } from './approvalStore'
import { applyCriticalPathRisk } from './criticalPaths'
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
  applyCriticalPathRisk(operation)
  return request<ApprovalOperation>(env, '/operations', { method: 'POST', body: JSON.stringify(operation) })
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
  idempotencyKey?: string,
): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, actor, idempotency_key: idempotencyKey }),
  })
}

export async function markSuperseded(env: Env, operationId: string, reason: string): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/supersede`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function cancelApproval(env: Env, operationId: string): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/cancel`, { method: 'POST' })
}

export async function markCommitPrepared(
  env: Env,
  operationId: string,
  input: { parentSha: string; commitSha: string; commitUrl?: string },
): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/prepared`, {
    method: 'POST',
    body: JSON.stringify({ parent_sha: input.parentSha, commit_sha: input.commitSha, commit_url: input.commitUrl }),
  })
}

export async function markPushed(env: Env, operationId: string): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/pushed`, { method: 'POST' })
}

export async function markCompleted(env: Env, operationId: string): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/completed`, { method: 'POST' })
}

export async function markPullRequest(
  env: Env,
  operationId: string,
  input: { number: number; url: string },
): Promise<ApprovalOperation> {
  return request<ApprovalOperation>(env, `/operations/${encodeURIComponent(operationId)}/pull-request`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function createTask(env: Env, task: TaskRecord): Promise<TaskRecord> {
  return request<TaskRecord>(env, '/tasks', { method: 'POST', body: JSON.stringify(task) })
}

export async function getTask(env: Env, taskId: string): Promise<TaskRecord> {
  return request<TaskRecord>(env, `/tasks/${encodeURIComponent(taskId)}`)
}

export async function listTasks(
  env: Env,
  filters: { kind?: string; projectId?: string; operationId?: string; limit?: number } = {},
): Promise<{ items: TaskRecord[]; count: number; total: number }> {
  const query = new URLSearchParams()
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.projectId) query.set('project_id', filters.projectId)
  if (filters.operationId) query.set('operation_id', filters.operationId)
  if (filters.limit) query.set('limit', String(filters.limit))
  return request(env, `/tasks?${query.toString()}`)
}

export async function updateTask(env: Env, taskId: string, update: Partial<TaskRecord>): Promise<TaskRecord> {
  return request<TaskRecord>(env, `/tasks/${encodeURIComponent(taskId)}/update`, {
    method: 'POST',
    body: JSON.stringify(update),
  })
}
