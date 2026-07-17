const API = 'https://api.github.com'

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'best-code-ide-worker',
  }
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } })
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/')
}

export interface DeliveryFileChange {
  path: string
  content?: string
  delete?: boolean
}

export interface PreparedCommit {
  sha: string
  url: string
  parentSha: string
  changedFiles: number
}

function normalizeChanges(changes: DeliveryFileChange[]): DeliveryFileChange[] {
  const normalized = changes
    .map((change) => ({ ...change, path: change.path.trim().replace(/^\/+/, '') }))
    .filter((change) => change.path)
  if (normalized.length === 0) throw new Error('At least one file change is required')
  if (normalized.length > 20) throw new Error('A prepared commit accepts at most 20 file changes')
  if (new Set(normalized.map((change) => change.path)).size !== normalized.length) {
    throw new Error('Each changed path must be unique')
  }
  const totalChars = normalized.reduce((sum, change) => sum + (change.content?.length ?? 0), 0)
  if (totalChars > 750_000) throw new Error('Prepared commit content exceeds 750000 characters')
  return normalized
}

export async function getBranchHead(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const response = await request(token, `${repoPath(owner, repo)}/git/ref/heads/${refPath(branch)}`)
  if (!response.ok) throw new Error(`Branch lookup failed ${response.status}: ${await response.text()}`)
  const ref = (await response.json()) as { object: { sha: string } }
  return ref.object.sha
}

/** Create Git blobs/tree/commit without moving the remote branch ref. */
export async function prepareCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  changes: DeliveryFileChange[],
): Promise<PreparedCommit> {
  const normalized = normalizeChanges(changes)
  const parentSha = await getBranchHead(token, owner, repo, branch)

  const commitResponse = await request(token, `${repoPath(owner, repo)}/git/commits/${parentSha}`)
  if (!commitResponse.ok) throw new Error(`Commit lookup failed ${commitResponse.status}: ${await commitResponse.text()}`)
  const parentCommit = (await commitResponse.json()) as { tree: { sha: string } }
  const baseTreeSha = parentCommit.tree.sha

  const treeResponse = await request(token, `${repoPath(owner, repo)}/git/trees/${baseTreeSha}?recursive=1`)
  if (!treeResponse.ok) throw new Error(`Tree lookup failed ${treeResponse.status}: ${await treeResponse.text()}`)
  const treeData = (await treeResponse.json()) as { tree?: { path: string; type: string; mode: string }[] }
  const modes = new Map(
    (treeData.tree ?? []).filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.mode]),
  )

  const entries = await Promise.all(
    normalized.map(async (change) => {
      if (change.delete) {
        if (!modes.has(change.path)) throw new Error(`Cannot delete missing file: ${change.path}`)
        return { path: change.path, mode: modes.get(change.path) ?? '100644', type: 'blob', sha: null }
      }

      const blobResponse = await request(token, `${repoPath(owner, repo)}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: change.content ?? '', encoding: 'utf-8' }),
      })
      if (!blobResponse.ok) {
        throw new Error(`Blob creation failed for ${change.path}: ${blobResponse.status} ${await blobResponse.text()}`)
      }
      const blob = (await blobResponse.json()) as { sha: string }
      return { path: change.path, mode: modes.get(change.path) ?? '100644', type: 'blob', sha: blob.sha }
    }),
  )

  const newTreeResponse = await request(token, `${repoPath(owner, repo)}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  })
  if (!newTreeResponse.ok) throw new Error(`Tree creation failed ${newTreeResponse.status}: ${await newTreeResponse.text()}`)
  const newTree = (await newTreeResponse.json()) as { sha: string }

  const newCommitResponse = await request(token, `${repoPath(owner, repo)}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: message.trim() || 'Apply approved BestCode changes', tree: newTree.sha, parents: [parentSha] }),
  })
  if (!newCommitResponse.ok) {
    throw new Error(`Commit creation failed ${newCommitResponse.status}: ${await newCommitResponse.text()}`)
  }
  const commit = (await newCommitResponse.json()) as { sha: string; html_url: string }
  return { sha: commit.sha, url: commit.html_url, parentSha, changedFiles: normalized.length }
}

/** Fast-forward a working branch to an already prepared commit. Force push is never used. */
export async function pushPreparedCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
  expectedParentSha: string,
): Promise<{ sha: string; branch: string }> {
  const current = await getBranchHead(token, owner, repo, branch)
  if (current !== expectedParentSha) {
    throw new Error(`BRANCH_CONFLICT: expected ${expectedParentSha} but ${branch} is now at ${current}`)
  }

  const response = await request(token, `${repoPath(owner, repo)}/git/refs/heads/${refPath(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false }),
  })
  if (!response.ok) throw new Error(`Branch push failed ${response.status}: ${await response.text()}`)
  return { sha: commitSha, branch }
}
