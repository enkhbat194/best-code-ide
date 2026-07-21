const API = 'https://api.github.com'

export interface MergedPullRequestHead {
  branch: string
  sha: string
  number: number
  merged_at: string
}

export async function listMergedPullRequestHeads(
  token: string,
  owner: string,
  repo: string,
  baseBranch: string,
): Promise<MergedPullRequestHead[]> {
  const params = new URLSearchParams({
    state: 'closed',
    base: baseBranch,
    per_page: '100',
    sort: 'updated',
    direction: 'desc',
  })
  const response = await fetch(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'best-code-ide-worker',
      },
    },
  )
  if (!response.ok) throw new Error(`GitHub pull request audit error ${response.status}: ${await response.text()}`)

  const data = (await response.json()) as {
    number: number
    merged_at: string | null
    base: { ref: string }
    head: { ref: string; sha: string; repo: { full_name: string } | null }
  }[]

  const repository = `${owner}/${repo}`.toLowerCase()
  return data
    .filter((item) => (
      Boolean(item.merged_at) &&
      item.base.ref === baseBranch &&
      item.head.repo?.full_name.toLowerCase() === repository &&
      item.head.ref.startsWith('agent/')
    ))
    .map((item) => ({
      branch: item.head.ref,
      sha: item.head.sha,
      number: item.number,
      merged_at: item.merged_at as string,
    }))
}

export function mergedPullRequestMatches(
  branch: { name: string; sha: string },
  mergedHeads: MergedPullRequestHead[],
): MergedPullRequestHead | undefined {
  return mergedHeads.find((item) => item.branch === branch.name && item.sha === branch.sha)
}
