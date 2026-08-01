import { clearWorkspace, writeFile } from './fs'
import { useSettingsStore } from '../store/settingsStore'

interface WorkspaceExportResponse {
  owner: string
  repo: string
  branch: string
  projectRoot?: string
  files: { path: string; sourcePath?: string; content: string }[]
  errors: { path: string; error: string }[]
  importedCount: number
  eligibleCount: number
  truncated: boolean
  maxFiles: number
  error?: string
}

interface RepositoryListResponse {
  repositories?: GitHubRepositorySummary[]
  error?: string
}

export interface GitHubRepositorySummary {
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  updatedAt: string
  description: string | null
}

export interface WorkspaceImportResult {
  importedCount: number
  eligibleCount: number
  truncated: boolean
  errorCount: number
  projectRoot: string
}

type RepositorySelection = Pick<GitHubRepositorySummary, 'owner' | 'name' | 'defaultBranch'>

function connectionSettings(): { backendUrl: string; authToken: string } {
  const { backendUrl, authToken } = useSettingsStore.getState()
  if (!backendUrl || !authToken) {
    throw new Error('Backend URL болон BestCode token тохиргоо дутуу байна')
  }
  return { backendUrl, authToken }
}

export async function listGitHubRepositories(): Promise<GitHubRepositorySummary[]> {
  const { backendUrl, authToken } = connectionSettings()
  const response = await fetch(`${backendUrl}/api/workspace/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ action: 'list' }),
  })

  const payload = (await response.json().catch(() => ({}))) as RepositoryListResponse
  if (!response.ok) throw new Error(payload.error || `GitHub repository list failed (${response.status})`)
  return payload.repositories ?? []
}

export async function importGitHubWorkspace(
  repositoryOrMaxFiles?: RepositorySelection | number,
  requestedMaxFiles = 300,
): Promise<WorkspaceImportResult> {
  const { backendUrl, authToken } = connectionSettings()
  const settings = useSettingsStore.getState()
  const repository = typeof repositoryOrMaxFiles === 'number' ? undefined : repositoryOrMaxFiles
  const maxFiles = typeof repositoryOrMaxFiles === 'number' ? repositoryOrMaxFiles : requestedMaxFiles
  const owner = repository?.owner ?? settings.owner
  const repo = repository?.name ?? settings.repo
  const branch = repository?.defaultBranch ?? settings.branch

  if (!owner || !repo || !branch) {
    throw new Error('GitHub repository сонгоогүй байна')
  }

  const response = await fetch(`${backendUrl}/api/workspace/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ action: 'export', owner, repo, branch, maxFiles }),
  })

  const payload = (await response.json().catch(() => ({}))) as WorkspaceExportResponse
  if (!response.ok) throw new Error(payload.error || `Workspace import failed (${response.status})`)

  await clearWorkspace()
  for (const file of payload.files) {
    await writeFile(`/${file.path.replace(/^\/+/, '')}`, file.content)
  }

  return {
    importedCount: payload.importedCount,
    eligibleCount: payload.eligibleCount,
    truncated: payload.truncated,
    errorCount: payload.errors.length,
    projectRoot: payload.projectRoot ?? '',
  }
}
