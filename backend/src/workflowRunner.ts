import { getTask, updateTask } from './approvalClient'
import type { TaskRecord, TaskStatus } from './approvalStore'
import type { Env } from './types'

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
  return fetch(`${API}${path}`, { ...init, headers: { ...headers(token, accept), ...(init.headers ?? {}) } })
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

export interface WorkflowRun {
  id: number
  status: string
  conclusion: string | null
  head_branch: string
  html_url: string
  created_at: string
  run_started_at?: string
  updated_at?: string
}

export interface WorkflowJob {
  id: number
  name: string
  status: string
  conclusion: string | null
}

export async function dispatchWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflow: string,
  branch: string,
  inputs: Record<string, string> = {},
): Promise<void> {
  const response = await request(token, `${repoPath(owner, repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: branch, inputs }),
  })
  if (!response.ok) throw new Error(`Workflow dispatch failed ${response.status}: ${await response.text()}`)
}

async function listRuns(
  token: string,
  owner: string,
  repo: string,
  workflow: string,
  branch: string,
): Promise<WorkflowRun[]> {
  const query = new URLSearchParams({ branch, event: 'workflow_dispatch', per_page: '20' })
  const response = await request(
    token,
    `${repoPath(owner, repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs?${query.toString()}`,
  )
  if (!response.ok) throw new Error(`Workflow runs lookup failed ${response.status}: ${await response.text()}`)
  const payload = (await response.json()) as { workflow_runs?: WorkflowRun[] }
  return payload.workflow_runs ?? []
}

export async function getRun(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<WorkflowRun> {
  const response = await request(token, `${repoPath(owner, repo)}/actions/runs/${runId}`)
  if (!response.ok) throw new Error(`Workflow run lookup failed ${response.status}: ${await response.text()}`)
  return response.json() as Promise<WorkflowRun>
}

export async function getRunJobs(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<WorkflowJob[]> {
  const response = await request(token, `${repoPath(owner, repo)}/actions/runs/${runId}/jobs?per_page=100`)
  if (!response.ok) throw new Error(`Workflow jobs lookup failed ${response.status}: ${await response.text()}`)
  const payload = (await response.json()) as { jobs?: WorkflowJob[] }
  return payload.jobs ?? []
}

function taskStatus(run: WorkflowRun): TaskStatus {
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'requested') return 'queued'
  if (run.status !== 'completed') return 'in_progress'
  return run.conclusion === 'success' ? 'completed' : run.conclusion === 'cancelled' ? 'cancelled' : 'failed'
}

export async function refreshWorkflowTask(env: Env, token: string, taskId: string): Promise<TaskRecord> {
  const task = await getTask(env, taskId)
  let run: WorkflowRun | undefined

  if (task.run_id) {
    run = await getRun(token, task.repository.owner, task.repository.repo, task.run_id)
  } else {
    const runs = await listRuns(token, task.repository.owner, task.repository.repo, task.workflow, task.branch)
    const threshold = Date.parse(task.created_at) - 10_000
    run = runs.find((candidate) => Date.parse(candidate.created_at) >= threshold)
    if (!run) return task
  }

  const status = taskStatus(run)
  return updateTask(env, task.task_id, {
    status,
    conclusion: run.conclusion,
    run_id: run.id,
    run_url: run.html_url,
    started_at: run.run_started_at ?? task.started_at,
    completed_at: status === 'completed' || status === 'failed' || status === 'cancelled'
      ? run.updated_at ?? new Date().toISOString()
      : undefined,
  })
}

async function readJobLog(token: string, owner: string, repo: string, jobId: number): Promise<string> {
  const response = await request(token, `${repoPath(owner, repo)}/actions/jobs/${jobId}/logs`, {}, 'text/plain')
  if (!response.ok) return `Unable to download job ${jobId} log (${response.status})`
  return response.text()
}

export async function readTaskLogs(
  env: Env,
  token: string,
  taskId: string,
  offset = 0,
  limit = 30_000,
): Promise<{ task: TaskRecord; jobs: WorkflowJob[]; content: string; next_offset: number | null; total_chars: number }> {
  const task = await refreshWorkflowTask(env, token, taskId)
  if (!task.run_id) return { task, jobs: [], content: '', next_offset: null, total_chars: 0 }
  const jobs = await getRunJobs(token, task.repository.owner, task.repository.repo, task.run_id)
  const chunks: string[] = []
  for (const job of jobs) {
    if (job.status !== 'completed' && task.status !== 'in_progress') continue
    const log = await readJobLog(token, task.repository.owner, task.repository.repo, job.id)
    chunks.push(`===== ${job.name} (${job.status}/${job.conclusion ?? '-'}) =====\n${log}`)
  }
  const all = chunks.join('\n\n')
  const safeOffset = Math.min(Math.max(Math.floor(offset), 0), all.length)
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1000), 50_000)
  const content = all.slice(safeOffset, safeOffset + safeLimit)
  const next = safeOffset + content.length < all.length ? safeOffset + content.length : null
  return { task, jobs, content, next_offset: next, total_chars: all.length }
}

export async function cancelWorkflowTask(env: Env, token: string, taskId: string): Promise<TaskRecord> {
  const task = await refreshWorkflowTask(env, token, taskId)
  if (!task.run_id) return updateTask(env, taskId, { status: 'cancelled', completed_at: new Date().toISOString() })
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task
  const response = await request(
    token,
    `${repoPath(task.repository.owner, task.repository.repo)}/actions/runs/${task.run_id}/cancel`,
    { method: 'POST' },
  )
  if (!response.ok && response.status !== 409) {
    throw new Error(`Workflow cancellation failed ${response.status}: ${await response.text()}`)
  }
  return updateTask(env, taskId, { status: 'cancelled', completed_at: new Date().toISOString() })
}
