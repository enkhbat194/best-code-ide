const API = 'https://api.github.com'

function headers(token: string, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'best-code-ide-worker',
  }
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function gh(token: string, path: string, init: RequestInit = {}, accept?: string): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { ...headers(token, accept), ...(init.headers ?? {}) } })
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function contentPath(path: string): string {
  return encodeURIComponent(path).replace(/%2F/g, '/')
}

export interface DirEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
}

export async function listDir(token: string, owner: string, repo: string, path: string, ref: string): Promise<DirEntry[]> {
  const res = await gh(token, `${repoPath(owner, repo)}/contents/${contentPath(path)}?ref=${encodeURIComponent(ref)}`)
  if (res.status === 404) throw new Error(`Path not found: ${path}`)
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as unknown
  if (!Array.isArray(data)) throw new Error(`${path} is a file, not a directory`)
  return data.map((e: { name: string; path: string; type: string; size: number }) => ({
    name: e.name,
    path: e.path,
    type: e.type === 'dir' ? 'dir' : 'file',
    size: e.size,
  }))
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
  sha: string
}

export async function getTree(token: string, owner: string, repo: string, ref: string): Promise<TreeEntry[]> {
  const res = await gh(token, `${repoPath(owner, repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  if (!res.ok) throw new Error(`GitHub tree error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { truncated?: boolean; tree?: { path: string; type: string; size?: number; sha: string }[] }
  if (data.truncated) throw new Error('Repository tree is too large and GitHub returned a truncated result')
  return (data.tree ?? [])
    .filter((entry) => entry.type === 'blob' || entry.type === 'tree')
    .map((entry) => ({ path: entry.path, type: entry.type as 'blob' | 'tree', size: entry.size, sha: entry.sha }))
}

export interface FileContent {
  content: string
  sha: string
}

export async function getFile(token: string, owner: string, repo: string, path: string, ref: string): Promise<FileContent | null> {
  const res = await gh(token, `${repoPath(owner, repo)}/contents/${contentPath(path)}?ref=${encodeURIComponent(ref)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: string; sha: string; type: string }
  if (data.type !== 'file' || !data.content) throw new Error(`${path} is not a file`)
  return { content: fromBase64(data.content), sha: data.sha }
}

export async function getFiles(
  token: string,
  owner: string,
  repo: string,
  paths: string[],
  ref: string,
): Promise<{ path: string; content?: string; error?: string }[]> {
  const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  if (uniquePaths.length === 0) throw new Error('At least one path is required')
  if (uniquePaths.length > 12) throw new Error('read_files accepts at most 12 files per call')
  return Promise.all(
    uniquePaths.map(async (path) => {
      try {
        const file = await getFile(token, owner, repo, path, ref)
        return file ? { path, content: file.content } : { path, error: 'File not found' }
      } catch (err) {
        return { path, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )
}

export interface CodeSearchResult {
  path: string
  repository: string
  url: string
  fragments: string[]
}

export async function searchCode(token: string, owner: string, repo: string, query: string, limit = 20): Promise<CodeSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('query is required')
  const q = `${trimmed} repo:${owner}/${repo}`
  const res = await gh(
    token,
    `/search/code?q=${encodeURIComponent(q)}&per_page=${Math.min(Math.max(limit, 1), 50)}`,
    {},
    'application/vnd.github.text-match+json',
  )
  if (!res.ok) throw new Error(`GitHub code search error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    items?: { path: string; html_url: string; repository: { full_name: string }; text_matches?: { fragment?: string }[] }[]
  }
  return (data.items ?? []).map((item) => ({
    path: item.path,
    repository: item.repository.full_name,
    url: item.html_url,
    fragments: (item.text_matches ?? []).map((match) => match.fragment ?? '').filter(Boolean).slice(0, 3),
  }))
}

export async function putFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
): Promise<{ commitUrl: string }> {
  const existing = await getFile(token, owner, repo, path, branch).catch(() => null)
  const res = await gh(token, `${repoPath(owner, repo)}/contents/${contentPath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(content), branch, sha: existing?.sha }),
  })
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { commit: { html_url: string } }
  return { commitUrl: data.commit.html_url }
}

export async function deleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
): Promise<void> {
  const existing = await getFile(token, owner, repo, path, branch)
  if (!existing) throw new Error(`File not found: ${path}`)
  const res = await gh(token, `${repoPath(owner, repo)}/contents/${contentPath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: existing.sha, branch }),
  })
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
}

export interface BranchInfo {
  name: string
  sha: string
  protected: boolean
}

export async function listBranches(token: string, owner: string, repo: string, limit = 30): Promise<BranchInfo[]> {
  const res = await gh(token, `${repoPath(owner, repo)}/branches?per_page=${Math.min(Math.max(limit, 1), 100)}`)
  if (!res.ok) throw new Error(`GitHub branch error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { name: string; protected: boolean; commit: { sha: string } }[]
  return data.map((branch) => ({ name: branch.name, sha: branch.commit.sha, protected: branch.protected }))
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromBranch: string,
): Promise<BranchInfo> {
  const source = await gh(token, `${repoPath(owner, repo)}/git/ref/heads/${contentPath(fromBranch)}`)
  if (!source.ok) throw new Error(`Source branch error ${source.status}: ${await source.text()}`)
  const sourceData = (await source.json()) as { object: { sha: string } }
  const res = await gh(token, `${repoPath(owner, repo)}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: sourceData.object.sha }),
  })
  if (!res.ok) throw new Error(`Create branch error ${res.status}: ${await res.text()}`)
  return { name: branchName, sha: sourceData.object.sha, protected: false }
}

export async function compareBranches(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<string> {
  const res = await gh(
    token,
    `${repoPath(owner, repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    {},
    'application/vnd.github.v3.diff',
  )
  if (!res.ok) throw new Error(`GitHub compare error ${res.status}: ${await res.text()}`)
  return res.text()
}

export interface CommitInfo {
  sha: string
  message: string
  url: string
  date: string
}

export async function listCommits(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path?: string,
  perPage = 10,
): Promise<CommitInfo[]> {
  const params = new URLSearchParams({ sha: branch, per_page: String(Math.min(Math.max(perPage, 1), 100)) })
  if (path) params.set('path', path)
  const res = await gh(token, `${repoPath(owner, repo)}/commits?${params.toString()}`)
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { sha: string; html_url: string; commit: { message: string; author: { date: string } } }[]
  return data.map((c) => ({ sha: c.sha, message: c.commit.message, url: c.html_url, date: c.commit.author.date }))
}

export async function dispatchValidation(token: string, owner: string, repo: string, branch: string): Promise<void> {
  const res = await gh(token, `${repoPath(owner, repo)}/actions/workflows/validate.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: branch }),
  })
  if (!res.ok) throw new Error(`Validation dispatch error ${res.status}: ${await res.text()}`)
}

export interface ValidationRun {
  id: number
  status: string
  conclusion: string | null
  branch: string
  url: string
  createdAt: string
}

export async function listValidationRuns(token: string, owner: string, repo: string, branch: string): Promise<ValidationRun[]> {
  const params = new URLSearchParams({ branch, per_page: '5' })
  const res = await gh(token, `${repoPath(owner, repo)}/actions/workflows/validate.yml/runs?${params.toString()}`)
  if (!res.ok) throw new Error(`Validation status error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    workflow_runs?: { id: number; status: string; conclusion: string | null; head_branch: string; html_url: string; created_at: string }[]
  }
  return (data.workflow_runs ?? []).map((run) => ({
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    url: run.html_url,
    createdAt: run.created_at,
  }))
}

export async function createRepo(token: string, name: string, isPrivate: boolean, description?: string): Promise<{ htmlUrl: string; defaultBranch: string }> {
  const res = await fetch(`${API}/user/repos`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name, private: isPrivate, description, auto_init: true }),
  })
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { html_url: string; default_branch: string }
  return { htmlUrl: data.html_url, defaultBranch: data.default_branch }
}
