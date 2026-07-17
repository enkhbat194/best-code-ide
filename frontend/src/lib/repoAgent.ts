import { useSettingsStore } from '../store/settingsStore'

interface ToolResponse {
  result: string
  branch?: string
}

export interface ApprovalChange {
  action: 'create' | 'update' | 'delete'
  path: string
  base_sha: string | null
  diff: string
}

export interface ApprovalOperation {
  operation_id: string
  purpose: 'code_change' | 'deployment'
  project_id: string
  repository: { owner: string; repo: string; full_name: string }
  branch: string
  title: string
  summary: string
  status:
    | 'pending_approval'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'expired'
    | 'commit_prepared'
    | 'pushed'
    | 'pull_request_opened'
    | 'deployment_started'
    | 'deployment_completed'
    | 'deployment_failed'
  approval_required: true
  risk: 'normal' | 'high'
  risk_reasons: string[]
  changes: ApprovalChange[]
  created_at: string
  updated_at: string
  expires_at: string
  prepared_commit_sha?: string
  prepared_commit_url?: string
  pushed_at?: string
  pr_number?: number
  pr_url?: string
  deployment_target?: string
  deployment_task_id?: string
}

export interface RepositoryTask {
  task_id: string
  kind: 'build' | 'test' | 'deployment'
  project_id: string
  operation_id: string | null
  repository: { owner: string; repo: string; full_name: string }
  branch: string
  workflow: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  conclusion: string | null
  run_id: number | null
  run_url: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

export interface TaskLogs {
  task: RepositoryTask
  jobs: { id: number; name: string; status: string; conclusion: string | null }[]
  content: string
  next_offset: number | null
  total_chars: number
}

function settings() {
  const value = useSettingsStore.getState()
  if (!value.isConfigured()) throw new Error('Backend, token, owner, repo, branch тохируулаагүй байна')
  return value
}

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { backendUrl, authToken } = settings()
  const res = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text || `Backend error ${res.status}`)
  return JSON.parse(text) as T
}

async function request(path: string, init?: RequestInit): Promise<ToolResponse> {
  return rawRequest<ToolResponse>(path, init)
}

function repoPrefix(): string {
  const { owner, repo } = settings()
  return `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

export async function compareBranches(base: string, head: string): Promise<string> {
  const query = new URLSearchParams({ base, head, branch: head })
  return (await request(`${repoPrefix()}/compare?${query.toString()}`)).result
}

export async function validationStatus(branch: string): Promise<string> {
  const query = new URLSearchParams({ branch })
  return (await request(`${repoPrefix()}/validation?${query.toString()}`)).result
}

export async function waitValidation(branch: string, waitSeconds = 35): Promise<string> {
  const query = new URLSearchParams({ branch, wait_seconds: String(waitSeconds) })
  return (await request(`${repoPrefix()}/validation/wait?${query.toString()}`)).result
}

export async function runValidation(branch: string, waitSeconds = 35): Promise<string> {
  const query = new URLSearchParams({ branch })
  return (
    await request(`${repoPrefix()}/validation?${query.toString()}`, {
      method: 'POST',
      body: JSON.stringify({ branch, wait_seconds: waitSeconds }),
    })
  ).result
}

export async function createDraftPullRequest(input: {
  title: string
  head: string
  base: string
  body?: string
}): Promise<string> {
  const query = new URLSearchParams({ branch: input.head })
  return (
    await request(`${repoPrefix()}/pulls?${query.toString()}`, {
      method: 'POST',
      body: JSON.stringify({ ...input, draft: true }),
    })
  ).result
}

export async function listApprovals(status = 'pending_approval'): Promise<ApprovalOperation[]> {
  const { owner, repo } = settings()
  const query = new URLSearchParams({ status, limit: '50' })
  const payload = await rawRequest<{ items: ApprovalOperation[] }>(`/api/approvals?${query.toString()}`)
  return payload.items.filter((item) => item.repository.owner === owner && item.repository.repo === repo)
}

export async function decideApproval(
  operationId: string,
  decision: 'approved' | 'rejected',
): Promise<ApprovalOperation> {
  return rawRequest<ApprovalOperation>(`/api/approvals/${encodeURIComponent(operationId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, actor: 'pwa-user' }),
  })
}

export async function getApproval(operationId: string): Promise<ApprovalOperation> {
  return rawRequest<ApprovalOperation>(`/api/approvals/${encodeURIComponent(operationId)}`)
}

export async function listRepositoryTasks(): Promise<RepositoryTask[]> {
  const { owner, repo } = settings()
  const payload = await rawRequest<{ items: RepositoryTask[] }>('/api/tasks?limit=50')
  return payload.items.filter((item) => item.repository.owner === owner && item.repository.repo === repo)
}

export async function startRepositoryTask(
  kind: 'build' | 'test',
  branch: string,
  operationId?: string,
): Promise<RepositoryTask> {
  const { owner, repo } = settings()
  return rawRequest<RepositoryTask>(`/api/tasks/${kind}`, {
    method: 'POST',
    body: JSON.stringify({ owner, repo, branch, operation_id: operationId }),
  })
}

export async function refreshRepositoryTask(taskId: string): Promise<RepositoryTask> {
  return rawRequest<RepositoryTask>(`/api/tasks/${encodeURIComponent(taskId)}`)
}

export async function readRepositoryTaskLogs(taskId: string, offset = 0): Promise<TaskLogs> {
  const query = new URLSearchParams({ offset: String(offset), limit: '30000' })
  return rawRequest<TaskLogs>(`/api/tasks/${encodeURIComponent(taskId)}/logs?${query.toString()}`)
}

export async function cancelRepositoryTask(taskId: string): Promise<RepositoryTask> {
  return rawRequest<RepositoryTask>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
}
