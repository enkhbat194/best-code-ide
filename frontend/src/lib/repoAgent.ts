import { useSettingsStore } from '../store/settingsStore'

interface ToolResponse {
  result: string
  branch?: string
}

interface ActionError {
  code: string
  message: string
  retryable: boolean
  action_required: string
}

interface ActionEnvelope<T> {
  ok: boolean
  operation_id: string
  status: string
  project_id?: string
  branch?: string
  approval_required?: boolean
  result?: T
  error?: ActionError
}

interface ProjectListItem {
  id: string
  repository: string
}

export interface RepositoryBranch {
  name: string
  sha: string
  protected: boolean
  default: boolean
}

export interface BranchDeletionResult {
  branch: string
  sha?: string
  deleted_sha?: string
  completed_at?: string | null
  next_action?: string
}

export interface ApprovalChange {
  action: 'create' | 'update' | 'delete'
  path: string
  base_sha: string | null
  diff: string
}

export interface ApprovalOperation {
  operation_id: string
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
    | 'completed'
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
  completed_at?: string
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

async function actionRequest<T>(name: string, body: Record<string, unknown>): Promise<ActionEnvelope<T>> {
  const payload = await rawRequest<ActionEnvelope<T>>(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!payload.ok || !payload.result) {
    const error = payload.error
    throw new Error(error ? `${error.code}: ${error.message} ${error.action_required}` : `${name} failed`)
  }
  return payload
}

async function configuredProjectId(): Promise<string> {
  const { owner, repo } = settings()
  const expected = `${owner}/${repo}`.toLowerCase()
  const payload = await actionRequest<{ items: ProjectListItem[] }>('projects_list', { limit: 50 })
  const project = payload.result?.items.find((item) => item.repository.toLowerCase() === expected)
  if (!project) throw new Error(`BestCode project registry-д ${owner}/${repo} олдсонгүй`)
  return project.id
}

function repoPrefix(): string {
  const { owner, repo } = settings()
  return `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

export async function compareBranches(base: string, head: string): Promise<string> {
  const query = new URLSearchParams({ base, head, branch: head })
  return (await request(`${repoPrefix()}/compare?${query.toString()}`)).result
}

export async function listBranches(): Promise<RepositoryBranch[]> {
  const projectId = await configuredProjectId()
  const payload = await actionRequest<{ items: RepositoryBranch[] }>('repository_list_branches', {
    project_id: projectId,
    limit: 100,
  })
  return payload.result?.items ?? []
}

export async function requestBranchDeletion(branch: string): Promise<ActionEnvelope<BranchDeletionResult>> {
  const projectId = await configuredProjectId()
  return actionRequest<BranchDeletionResult>('repository_delete_branch', {
    project_id: projectId,
    branch,
    title: `Delete repository branch ${branch}`,
    summary: `Branch cleanup audit-аар ангилсан ${branch} branch-ийг SHA-pinned high-risk approval-аар устгах хүсэлт.`,
  })
}

export async function completeBranchDeletion(
  branch: string,
  approvalOperationId: string,
): Promise<ActionEnvelope<BranchDeletionResult>> {
  const projectId = await configuredProjectId()
  return actionRequest<BranchDeletionResult>('repository_delete_branch', {
    project_id: projectId,
    branch,
    approval_operation_id: approvalOperationId,
  })
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
  return payload.items.filter(
    (item) => item.repository.owner.toLowerCase() === owner.toLowerCase() && item.repository.repo.toLowerCase() === repo.toLowerCase(),
  )
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
  return payload.items.filter(
    (item) => item.repository.owner.toLowerCase() === owner.toLowerCase() && item.repository.repo.toLowerCase() === repo.toLowerCase(),
  )
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
