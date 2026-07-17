import { useSettingsStore } from '../store/settingsStore'

interface CommitParams {
  path: string
  content: string
  message: string
}

export interface CommitResult {
  status: string
  approvalRequired: boolean
  branch: string
  // Present in direct-commit mode:
  commitUrl?: string
  // Present in approval mode (REQUIRE_APPROVALS=true on the Worker):
  operationId?: string
  risk?: 'normal' | 'high'
  diff?: string
}

export async function commitFile({ path, content, message }: CommitParams): Promise<CommitResult> {
  const { backendUrl, authToken, owner, repo, branch } = useSettingsStore.getState()
  if (!backendUrl || !authToken) throw new Error('Backend URL/token тохируулаагүй байна')
  if (!owner || !repo) throw new Error('GitHub owner/repo тохируулаагүй байна')

  const res = await fetch(`${backendUrl}/api/files/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ owner, repo, branch, path: path.replace(/^\//, ''), content, message }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Өөрчлөлт хадгалах амжилтгүй (${res.status}): ${text || res.statusText}`)
  return JSON.parse(text) as CommitResult
}
