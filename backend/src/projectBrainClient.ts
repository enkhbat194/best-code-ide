import type { ProjectHandoffRecord, ProjectTaskRecord } from './approvalStore'
import type { Env } from './types'

function stub(env: Env): DurableObjectStub {
  if (!env.APPROVALS) throw new Error('Project Brain storage is not configured')
  return env.APPROVALS.get(env.APPROVALS.idFromName('bestcode-approvals-v1'))
}

async function request<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await stub(env).fetch(`https://approval-store${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Project Brain store error ${response.status}`)
  return payload
}

export async function createProjectTask(env: Env, task: ProjectTaskRecord): Promise<ProjectTaskRecord> {
  return request<ProjectTaskRecord>(env, '/project-tasks', { method: 'POST', body: JSON.stringify(task) })
}

export async function getProjectTask(env: Env, taskId: string): Promise<ProjectTaskRecord> {
  return request<ProjectTaskRecord>(env, `/project-tasks/${encodeURIComponent(taskId)}`)
}

export async function listProjectTasks(
  env: Env,
  filters: { projectId?: string; status?: string; limit?: number } = {},
): Promise<{ items: ProjectTaskRecord[]; count: number; total: number }> {
  const query = new URLSearchParams()
  if (filters.projectId) query.set('project_id', filters.projectId)
  if (filters.status) query.set('status', filters.status)
  if (filters.limit) query.set('limit', String(filters.limit))
  return request(env, `/project-tasks?${query.toString()}`)
}

export async function updateProjectTask(
  env: Env,
  taskId: string,
  update: Partial<ProjectTaskRecord>,
): Promise<ProjectTaskRecord> {
  return request<ProjectTaskRecord>(env, `/project-tasks/${encodeURIComponent(taskId)}/update`, {
    method: 'POST',
    body: JSON.stringify(update),
  })
}

export async function createProjectHandoff(
  env: Env,
  handoff: ProjectHandoffRecord,
): Promise<ProjectHandoffRecord> {
  return request<ProjectHandoffRecord>(env, '/handoffs', { method: 'POST', body: JSON.stringify(handoff) })
}

export async function listProjectHandoffs(
  env: Env,
  filters: { projectId?: string; taskId?: string; limit?: number } = {},
): Promise<{ items: ProjectHandoffRecord[]; count: number; total: number }> {
  const query = new URLSearchParams()
  if (filters.projectId) query.set('project_id', filters.projectId)
  if (filters.taskId) query.set('task_id', filters.taskId)
  if (filters.limit) query.set('limit', String(filters.limit))
  return request(env, `/handoffs?${query.toString()}`)
}
