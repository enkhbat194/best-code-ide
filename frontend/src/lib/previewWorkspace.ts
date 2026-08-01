import type { BundleFile } from './bundler'
import { useSettingsStore } from '../store/settingsStore'
import type { GitHubRepositorySummary } from './workspace'

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

export interface GitHubPreviewWorkspace {
  files: BundleFile[]
  importedCount: number
  eligibleCount: number
  truncated: boolean
  errorCount: number
  projectRoot: string
}

type RepositorySelection = Pick<GitHubRepositorySummary, 'owner' | 'name' | 'defaultBranch'>

/**
 * Fetches a GitHub repository for Preview only.
 *
 * This deliberately does not write to BestCode's IndexedDB workspace and does
 * not modify the persistent owner/repo/branch settings.
 */
export async function fetchGitHubPreviewWorkspace(
  repository: RepositorySelection,
  maxFiles = 300,
): Promise<GitHubPreviewWorkspace> {
  const { backendUrl, authToken } = useSettingsStore.getState()
  if (!backendUrl || !authToken) {
    throw new Error('Backend URL болон BestCode token тохиргоо дутуу байна')
  }

  const response = await fetch(`${backendUrl}/api/workspace/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      action: 'export',
      owner: repository.owner,
      repo: repository.name,
      branch: repository.defaultBranch,
      maxFiles,
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as WorkspaceExportResponse
  if (!response.ok) throw new Error(payload.error || `Preview fetch failed (${response.status})`)

  return {
    files: payload.files.map((file) => ({
      path: `/${file.path.replace(/^\/+/, '')}`,
      content: file.content,
    })),
    importedCount: payload.importedCount,
    eligibleCount: payload.eligibleCount,
    truncated: payload.truncated,
    errorCount: payload.errors.length,
    projectRoot: payload.projectRoot ?? '',
  }
}
