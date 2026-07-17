const API = 'https://api.github.com'

function headers(token: string, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'best-code-ide-worker',
  }
}

async function request(token: string, path: string, init: RequestInit = {}, accept?: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token, accept), ...(init.headers ?? {}) },
  })
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/')
}

export interface AtomicFileChange {
  path: string
  content?: string
  delete?: boolean
}

export interface AtomicCommitResult {
  sha: string
  url: string
  changedFiles: number
}

/** Commit several file changes as one Git commit, then fast-forward the selected branch. */
export async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  changes: AtomicFileChange[],
): Promise<AtomicCommitResult> {
  const normalized = changes
    .map((change) => ({ ...change, path: change.path.trim().replace(/^\/+/, '') }))
    .filter((change) => change.path)

  if (normalized.length === 0) throw new Error('At least one file change is required')
  if (normalized.length > 20) throw new Error('A single atomic commit accepts at most 20 file changes')
  if (new Set(normalized.map((change) => change.path)).size !== normalized.length) {
    throw new Error('Each changed path must be unique')
  }
  const totalChars = normalized.reduce((sum, change) => sum + (change.content?.length ?? 0), 0)
  if (totalChars > 750_000) throw new Error('Atomic commit content is too large; split it into smaller coherent commits')

  const refRes = await request(token, `${repoPath(owner, repo)}/git/ref/heads/${refPath(branch)}`)
  if (!refRes.ok) throw new Error(`Branch lookup failed ${refRes.status}: ${await refRes.text()}`)
  const ref = (await refRes.json()) as { object: { sha: string } }
  const parentSha = ref.object.sha

  const commitRes = await request(token, `${repoPath(owner, repo)}/git/commits/${parentSha}`)
  if (!commitRes.ok) throw new Error(`Commit lookup failed ${commitRes.status}: ${await commitRes.text()}`)
  const parentCommit = (await commitRes.json()) as { tree: { sha: string } }
  const baseTreeSha = parentCommit.tree.sha

  const recursiveTreeRes = await request(token, `${repoPath(owner, repo)}/git/trees/${baseTreeSha}?recursive=1`)
  if (!recursiveTreeRes.ok) throw new Error(`Tree lookup failed ${recursiveTreeRes.status}: ${await recursiveTreeRes.text()}`)
  const recursiveTree = (await recursiveTreeRes.json()) as { tree?: { path: string; type: string; mode: string }[] }
  const existingModes = new Map(
    (recursiveTree.tree ?? [])
      .filter((entry) => entry.type === 'blob')
      .map((entry) => [entry.path, entry.mode]),
  )

  const treeEntries = await Promise.all(
    normalized.map(async (change) => {
      if (change.delete) {
        if (!existingModes.has(change.path)) throw new Error(`Cannot delete missing file: ${change.path}`)
        return { path: change.path, mode: existingModes.get(change.path) ?? '100644', type: 'blob', sha: null }
      }

      const blobRes = await request(token, `${repoPath(owner, repo)}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: change.content ?? '', encoding: 'utf-8' }),
      })
      if (!blobRes.ok) throw new Error(`Blob creation failed for ${change.path}: ${blobRes.status} ${await blobRes.text()}`)
      const blob = (await blobRes.json()) as { sha: string }
      return {
        path: change.path,
        mode: existingModes.get(change.path) ?? '100644',
        type: 'blob',
        sha: blob.sha,
      }
    }),
  )

  const treeRes = await request(token, `${repoPath(owner, repo)}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  })
  if (!treeRes.ok) throw new Error(`Tree creation failed ${treeRes.status}: ${await treeRes.text()}`)
  const tree = (await treeRes.json()) as { sha: string }

  const newCommitRes = await request(token, `${repoPath(owner, repo)}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: message.trim() || 'Update project files', tree: tree.sha, parents: [parentSha] }),
  })
  if (!newCommitRes.ok) throw new Error(`Commit creation failed ${newCommitRes.status}: ${await newCommitRes.text()}`)
  const newCommit = (await newCommitRes.json()) as { sha: string; html_url: string }

  const updateRefRes = await request(token, `${repoPath(owner, repo)}/git/refs/heads/${refPath(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  })
  if (!updateRefRes.ok) throw new Error(`Branch update failed ${updateRefRes.status}: ${await updateRefRes.text()}`)

  return { sha: newCommit.sha, url: newCommit.html_url, changedFiles: normalized.length }
}

export interface PullRequestResult {
  number: number
  url: string
  state: string
  draft: boolean
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  input: { title: string; head: string; base: string; body?: string; draft?: boolean },
): Promise<PullRequestResult> {
  const res = await request(token, `${repoPath(owner, repo)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body ?? '',
      draft: input.draft !== false,
    }),
  })
  if (!res.ok) throw new Error(`Pull request creation failed ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { number: number; html_url: string; state: string; draft: boolean }
  return { number: data.number, url: data.html_url, state: data.state, draft: data.draft }
}

export interface ValidationJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  failedLog?: string
}

export interface ValidationDetails {
  id: number
  status: string
  conclusion: string | null
  branch: string
  url: string
  createdAt: string
  jobs: ValidationJob[]
}

interface WorkflowRunSummary {
  id: number
  status: string
  conclusion: string | null
  head_branch: string
  html_url: string
  created_at: string
}

async function listValidationRuns(token: string, owner: string, repo: string, branch: string): Promise<WorkflowRunSummary[]> {
  const query = new URLSearchParams({ branch, per_page: '10' })
  const res = await request(token, `${repoPath(owner, repo)}/actions/workflows/validate.yml/runs?${query.toString()}`)
  if (!res.ok) throw new Error(`Validation run lookup failed ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { workflow_runs?: WorkflowRunSummary[] }
  return data.workflow_runs ?? []
}

async function readFailedJobLog(token: string, owner: string, repo: string, jobId: number): Promise<string> {
  const res = await request(token, `${repoPath(owner, repo)}/actions/jobs/${jobId}/logs`, {}, 'text/plain')
  if (!res.ok) return `Unable to download job log (${res.status})`
  const text = await res.text()
  const lines = text.split('\n')
  const useful = lines.filter((line) => /error|failed|failure|TS\d+|npm ERR|##\[error\]/i.test(line))
  const selected = useful.length > 0 ? useful.slice(-120).join('\n') : lines.slice(-120).join('\n')
  return selected.slice(-14_000)
}

export async function getValidationDetails(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<ValidationDetails> {
  const runRes = await request(token, `${repoPath(owner, repo)}/actions/runs/${runId}`)
  if (!runRes.ok) throw new Error(`Validation run ${runId} not found: ${runRes.status} ${await runRes.text()}`)
  const run = (await runRes.json()) as WorkflowRunSummary

  const jobsRes = await request(token, `${repoPath(owner, repo)}/actions/runs/${runId}/jobs?per_page=100`)
  if (!jobsRes.ok) throw new Error(`Validation jobs lookup failed ${jobsRes.status}: ${await jobsRes.text()}`)
  const jobsData = (await jobsRes.json()) as {
    jobs?: { id: number; name: string; status: string; conclusion: string | null }[]
  }

  const jobs = await Promise.all(
    (jobsData.jobs ?? []).map(async (job): Promise<ValidationJob> => {
      const failed = job.status === 'completed' && job.conclusion !== 'success' && job.conclusion !== 'skipped'
      return {
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        failedLog: failed ? await readFailedJobLog(token, owner, repo, job.id) : undefined,
      }
    }),
  )

  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    url: run.html_url,
    createdAt: run.created_at,
    jobs,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll the latest validation run on a branch and include failed job logs when it completes. */
export async function waitForValidation(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  timeoutSeconds = 35,
): Promise<ValidationDetails | null> {
  const timeout = Math.min(Math.max(Math.floor(timeoutSeconds), 0), 45) * 1000
  const deadline = Date.now() + timeout
  let latest: WorkflowRunSummary | undefined

  do {
    const runs = await listValidationRuns(token, owner, repo, branch)
    latest = runs[0]
    if (latest?.status === 'completed') return getValidationDetails(token, owner, repo, latest.id)
    if (Date.now() >= deadline) break
    await sleep(3500)
  } while (true)

  return latest ? getValidationDetails(token, owner, repo, latest.id) : null
}
