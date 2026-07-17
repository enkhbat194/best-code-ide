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
  project_id: string
  repository: { owner: string; repo: string; full_name: string }
  branch: string
  title: string
  summary: string
  status: 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'committed'
  approval_required: true
  risk: 'normal' | 'high'
  risk_reasons: string[]
  changes: ApprovalChange[]
  created_at: string
  updated_at: string
  expires_at: string
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
