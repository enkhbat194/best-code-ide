import { writeFile } from './fs'
import { useSettingsStore } from '../store/settingsStore'

interface WorkspaceExportResponse {
  owner: string
  repo: string
  branch: string
  files: { path: string; content: string }[]
  errors: { path: string; error: string }[]
  importedCount: number
  eligibleCount: number
  truncated: boolean
  maxFiles: number
  error?: string
}

export interface WorkspaceImportResult {
  importedCount: number
  eligibleCount: number
  truncated: boolean
  errorCount: number
}

export async function importGitHubWorkspace(maxFiles = 40): Promise<WorkspaceImportResult> {
  const { backendUrl, authToken, owner, repo, branch } = useSettingsStore.getState()
  if (!backendUrl || !authToken || !owner || !repo || !branch) {
    throw new Error('Backend болон GitHub repository тохиргоо дутуу байна')
  }

  const response = await fetch(`${backendUrl}/api/workspace/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ owner, repo, branch, maxFiles }),
  })

  const payload = (await response.json().catch(() => ({}))) as WorkspaceExportResponse
  if (!response.ok) throw new Error(payload.error || `Workspace import failed (${response.status})`)

  for (const file of payload.files) {
    await writeFile(`/${file.path.replace(/^\/+/, '')}`, file.content)
  }

  return {
    importedCount: payload.importedCount,
    eligibleCount: payload.eligibleCount,
    truncated: payload.truncated,
    errorCount: payload.errors.length,
  }
}
