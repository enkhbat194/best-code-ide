import { useSettingsStore } from '../store/settingsStore'

interface CommitParams {
  path: string
  content: string
  message: string
}

export async function commitFile({ path, content, message }: CommitParams): Promise<void> {
  const { backendUrl, authToken, owner, repo, branch } = useSettingsStore.getState()
  if (!backendUrl || !authToken) throw new Error('Backend URL/token тохируулаагүй байна')
  if (!owner || !repo) throw new Error('GitHub owner/repo тохируулаагүй байна')

  const res = await fetch(`${backendUrl}/api/files/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ owner, repo, branch, path: path.replace(/^\//, ''), content, message }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Push амжилтгүй (${res.status}): ${text}`)
  }
}
