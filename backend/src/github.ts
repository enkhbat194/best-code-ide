const API = 'https://api.github.com'

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
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

async function gh(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } })
}

export interface DirEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
}

export async function listDir(token: string, owner: string, repo: string, path: string, ref: string): Promise<DirEntry[]> {
  const res = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`)
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

export interface FileContent {
  content: string
  sha: string
}

export async function getFile(token: string, owner: string, repo: string, path: string, ref: string): Promise<FileContent | null> {
  const res = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: string; sha: string; type: string }
  if (data.type !== 'file' || !data.content) throw new Error(`${path} is not a file`)
  return { content: fromBase64(data.content), sha: data.sha }
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
  const res = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: toBase64(content),
      branch,
      sha: existing?.sha,
    }),
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
  const res = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: existing.sha, branch }),
  })
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
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
  const params = new URLSearchParams({ sha: branch, per_page: String(perPage) })
  if (path) params.set('path', path)
  const res = await gh(token, `/repos/${owner}/${repo}/commits?${params.toString()}`)
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { sha: string; html_url: string; commit: { message: string; author: { date: string } } }[]
  return data.map((c) => ({ sha: c.sha, message: c.commit.message, url: c.html_url, date: c.commit.author.date }))
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
