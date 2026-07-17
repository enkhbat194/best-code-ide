import { useSettingsStore } from '../store/settingsStore'

interface ToolResponse {
  result: string
  branch?: string
}

function settings() {
  const value = useSettingsStore.getState()
  if (!value.isConfigured()) throw new Error('Backend, token, owner, repo, branch тохируулаагүй байна')
  return value
}

async function request(path: string, init?: RequestInit): Promise<ToolResponse> {
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
  return JSON.parse(text) as ToolResponse
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
