const API = 'https://api.github.com'

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'best-code-ide-worker',
  }
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function contentPath(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/')
}

async function request(token: string, path: string): Promise<Response> {
  return fetch(`${API}${path}`, { headers: headers(token) })
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

export interface RepositoryTreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
  sha: string
}

export async function listAccessibleRepositories(token: string, limit = 300): Promise<GitHubRepositorySummary[]> {
  const repositories: GitHubRepositorySummary[] = []
  const max = Math.min(Math.max(Math.floor(limit), 1), 300)

  for (let page = 1; repositories.length < max; page += 1) {
    const perPage = Math.min(100, max - repositories.length)
    const params = new URLSearchParams({
      affiliation: 'owner,collaborator,organization_member',
      sort: 'updated',
      direction: 'desc',
      per_page: String(perPage),
      page: String(page),
    })
    const response = await request(token, `/user/repos?${params.toString()}`)
    if (!response.ok) throw new Error(`GitHub repository list error ${response.status}: ${await response.text()}`)

    const pageItems = (await response.json()) as {
      name: string
      full_name: string
      private: boolean
      default_branch: string
      updated_at: string
      description: string | null
      owner: { login: string }
    }[]

    repositories.push(
      ...pageItems.map((repository) => ({
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        defaultBranch: repository.default_branch || 'main',
        updatedAt: repository.updated_at,
        description: repository.description,
      })),
    )

    if (pageItems.length < perPage) break
  }

  return repositories.slice(0, max)
}

async function resolveTreeSha(token: string, owner: string, repo: string, ref: string): Promise<string> {
  const branchResponse = await request(token, `${repoPath(owner, repo)}/branches/${contentPath(ref)}`)
  let commitSha = ref

  if (branchResponse.ok) {
    const branch = (await branchResponse.json()) as { commit: { sha: string } }
    commitSha = branch.commit.sha
  } else if (branchResponse.status !== 404) {
    throw new Error(`GitHub branch error ${branchResponse.status}: ${await branchResponse.text()}`)
  }

  const commitResponse = await request(token, `${repoPath(owner, repo)}/git/commits/${encodeURIComponent(commitSha)}`)
  if (!commitResponse.ok) throw new Error(`GitHub commit error ${commitResponse.status}: ${await commitResponse.text()}`)
  const commit = (await commitResponse.json()) as { tree: { sha: string } }
  return commit.tree.sha
}

export async function getRepositoryTree(
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<RepositoryTreeEntry[]> {
  const treeSha = await resolveTreeSha(token, owner, repo, ref)
  const response = await request(token, `${repoPath(owner, repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`)
  if (!response.ok) throw new Error(`GitHub tree error ${response.status}: ${await response.text()}`)

  const data = (await response.json()) as {
    truncated?: boolean
    tree?: { path: string; type: string; size?: number; sha: string }[]
  }
  if (data.truncated) throw new Error('Repository tree is too large and GitHub returned a truncated result')

  return (data.tree ?? [])
    .filter((entry) => entry.type === 'blob' || entry.type === 'tree')
    .map((entry) => ({
      path: entry.path,
      type: entry.type as 'blob' | 'tree',
      size: entry.size,
      sha: entry.sha,
    }))
}
