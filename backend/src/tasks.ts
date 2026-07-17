import { createTask, getApproval, listTasks, updateTask } from './approvalClient'
import type { TaskKind, TaskRecord } from './approvalStore'
import { getProject, listProjects, type ProjectConfig } from './projects'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import { cancelWorkflowTask, dispatchWorkflow, readTaskLogs, refreshWorkflowTask } from './workflowRunner'
import type { Env } from './types'

function publicTask(task: TaskRecord) {
  return {
    task_id: task.task_id,
    kind: task.kind,
    project_id: task.project_id,
    operation_id: task.operation_id ?? null,
    repository: task.repository,
    branch: task.branch,
    workflow: task.workflow,
    status: task.status,
    conclusion: task.conclusion ?? null,
    run_id: task.run_id ?? null,
    run_url: task.run_url ?? null,
    created_at: task.created_at,
    updated_at: task.updated_at,
    started_at: task.started_at ?? null,
    completed_at: task.completed_at ?? null,
    error: task.error ?? null,
  }
}

function resolveProject(env: Env, body: Record<string, unknown>): ProjectConfig {
  if (typeof body.project_id === 'string' && body.project_id.trim()) return getProject(env, body.project_id.trim())
  const owner = typeof body.owner === 'string' ? body.owner.trim() : ''
  const repo = typeof body.repo === 'string' ? body.repo.trim() : ''
  const project = listProjects(env).find((item) => item.owner === owner && item.repo === repo)
  if (!project) throw new Error('Project not found or not permitted')
  return project
}

function workflowFor(project: ProjectConfig, kind: TaskKind): string | undefined {
  return kind === 'build' ? project.buildWorkflow : kind === 'test' ? project.testWorkflow : project.deployWorkflow
}

function protectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master'
}

async function validateOperation(env: Env, project: ProjectConfig, branch: string, operationId?: string): Promise<void> {
  if (!operationId) return
  const operation = await getApproval(env, operationId)
  if (operation.project_id !== project.id || operation.branch !== branch) {
    throw new Error('Operation does not belong to this project and branch')
  }
  if (operation.status !== 'pushed' && operation.status !== 'pull_request_opened') {
    throw new Error(`Operation must be pushed before build/test; current status is ${operation.status}`)
  }
}

async function startTask(
  env: Env,
  token: string,
  project: ProjectConfig,
  kind: TaskKind,
  branch: string,
  operationId?: string,
): Promise<TaskRecord> {
  if (protectedBranch(branch)) throw new Error('Build/test task must target a working branch, not main/master')
  const workflow = workflowFor(project, kind)
  if (!workflow) throw new Error(`${kind} workflow is not configured for ${project.id}`)
  await validateOperation(env, project, branch, operationId)

  const now = new Date().toISOString()
  const task: TaskRecord = {
    task_id: crypto.randomUUID(),
    kind,
    project_id: project.id,
    operation_id: operationId,
    repository: { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` },
    branch,
    workflow,
    status: 'queued',
    created_at: now,
    updated_at: now,
  }
  await createTask(env, task)

  try {
    await dispatchWorkflow(token, project.owner, project.repo, workflow, branch)
    return task
  } catch (error) {
    await updateTask(env, task.task_id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function handleTasks(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/tasks')) return null

  const token = resolveSecret(env, 'GITHUB_TOKEN')
  if (!token) return jsonError('GITHUB_TOKEN secret is missing', 500)

  try {
    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      const projectId = url.searchParams.get('project_id') ?? undefined
      const kind = url.searchParams.get('kind') ?? undefined
      const operationId = url.searchParams.get('operation_id') ?? undefined
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 100)
      const result = await listTasks(env, { projectId, kind, operationId, limit })
      return jsonResponse({ items: result.items.map(publicTask), count: result.count, total: result.total })
    }

    if ((url.pathname === '/api/tasks/build' || url.pathname === '/api/tasks/test') && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body) return jsonError('Invalid JSON body')
      const project = resolveProject(env, body)
      const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
      if (!branch) return jsonError('branch is required')
      const operationId = typeof body.operation_id === 'string' && body.operation_id.trim()
        ? body.operation_id.trim()
        : undefined
      const kind: TaskKind = url.pathname.endsWith('/build') ? 'build' : 'test'
      const task = await startTask(env, token, project, kind, branch, operationId)
      return jsonResponse(publicTask(task), 202)
    }

    const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]{16,64})(?:\/(logs|cancel))?$/i)
    if (!match) return jsonError('Not found', 404)
    const taskId = match[1]
    const action = match[2]

    if (!action && req.method === 'GET') {
      return jsonResponse(publicTask(await refreshWorkflowTask(env, token, taskId)))
    }

    if (action === 'logs' && req.method === 'GET') {
      const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0)
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '30000'), 1000), 50000)
      const result = await readTaskLogs(env, token, taskId, offset, limit)
      return jsonResponse({
        task: publicTask(result.task),
        jobs: result.jobs,
        content: result.content,
        next_offset: result.next_offset,
        total_chars: result.total_chars,
      })
    }

    if (action === 'cancel' && req.method === 'POST') {
      return jsonResponse(publicTask(await cancelWorkflowTask(env, token, taskId)))
    }

    return jsonError('Method not allowed', 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /not found/i.test(message) ? 404 : /must|cannot|does not|not configured/i.test(message) ? 409 : 502
    return jsonError(message, status)
  }
}
