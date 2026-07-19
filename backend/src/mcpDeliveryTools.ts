import * as gh from './github'
import { createTask, getApproval, getTask, listTasks, markCommitPrepared, markPullRequest, markPushed, markSuperseded, updateTask } from './approvalClient'
import type { ApprovalOperation, TaskKind, TaskRecord } from './approvalStore'
import * as agentGit from './agentGit'
import { getBranchHead, prepareCommit, pushPreparedCommit } from './gitDelivery'
import { getProject, type ProjectConfig } from './projects'
import { cancelWorkflowTask, dispatchWorkflow, readTaskLogs, refreshWorkflowTask } from './workflowRunner'
import type { Env } from './types'

const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    operation_id: { type: 'string' },
    task_id: { type: 'string' },
    status: { type: 'string' },
    project_id: { type: 'string' },
    repository: { type: 'object' },
    branch: { type: 'string' },
    result: { type: 'object' },
    error: { type: 'object' },
  },
  required: ['ok', 'operation_id', 'status'],
} as const

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

export const deliveryMcpTools = [
  {
    name: 'repository_commit',
    title: 'Prepare approved Git commit',
    description: 'Create a Git commit object from an approved BestCode operation without moving the remote branch ref. Exact base SHA conflicts stop the operation.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        operation_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['project_id', 'operation_id'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'repository_push',
    title: 'Push prepared commit',
    description: 'Fast-forward the approved operation working branch to its prepared commit. Force push and main/master are blocked.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, operation_id: { type: 'string' } },
      required: ['project_id', 'operation_id'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'repository_create_pull_request',
    title: 'Create approved pull request',
    description: 'Create a draft pull request for a pushed approved operation after configured build and test tasks succeed.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        operation_id: { type: 'string' },
        base: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        draft: { type: 'boolean', default: true },
      },
      required: ['project_id', 'operation_id'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'build_start',
    title: 'Start build workflow',
    description: 'Dispatch the configured GitHub Actions build workflow and return a durable task ID.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        operation_id: { type: 'string', description: 'Optional pushed approval operation to associate with this build.' },
      },
      required: ['project_id', 'branch'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'build_status',
    title: 'Get build status',
    description: 'Refresh and return one build task status from GitHub Actions.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, task_id: { type: 'string' } },
      required: ['project_id', 'task_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'build_logs',
    title: 'Read build logs',
    description: 'Read bounded paginated GitHub Actions logs for one build task.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        task_id: { type: 'string' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1000, maximum: 50000, default: 30000 },
      },
      required: ['project_id', 'task_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'test_start',
    title: 'Start test workflow',
    description: 'Dispatch the configured GitHub Actions test workflow and return a durable task ID.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        operation_id: { type: 'string' },
      },
      required: ['project_id', 'branch'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'test_status',
    title: 'Get test status',
    description: 'Refresh and return one test task status from GitHub Actions.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, task_id: { type: 'string' } },
      required: ['project_id', 'task_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'task_get',
    title: 'Get BestCode task',
    description: 'Get and refresh one build, test, or deployment task.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, task_id: { type: 'string' } },
      required: ['project_id', 'task_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'task_cancel',
    title: 'Cancel BestCode task',
    description: 'Cancel a running GitHub Actions task. Completed tasks are left unchanged.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, task_id: { type: 'string' } },
      required: ['project_id', 'task_id'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'preview_get',
    title: 'Get project preview',
    description: 'Return the configured preview URL for a project. No URL is fabricated when the project has no preview configuration.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, branch: { type: 'string' } },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
] as const

interface ToolEnvelope {
  ok: boolean
  operation_id: string
  task_id?: string
  status: string
  project_id?: string
  repository?: { owner: string; repo: string; full_name: string }
  branch?: string
  result?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean; action_required: string }
}

export interface DeliveryToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: ToolEnvelope
  isError?: boolean
}

function finish(envelope: ToolEnvelope): DeliveryToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    ...(envelope.ok ? {} : { isError: true }),
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function repo(project: ProjectConfig) {
  return { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` }
}

function assertProject(operation: ApprovalOperation, project: ProjectConfig): void {
  if (operation.project_id !== project.id) throw new Error('Operation not found for this project')
}

function assertWorkingBranch(branch: string): void {
  if (branch === 'main' || branch === 'master') throw new Error('PROTECTED_BRANCH: delivery to main/master is blocked')
}

async function assertBaseShas(token: string, operation: ApprovalOperation): Promise<void> {
  if (operation.base_context_sha) {
    const currentHead = await getBranchHead(
      token,
      operation.repository.owner,
      operation.repository.repo,
      operation.branch,
    )
    if (currentHead !== operation.base_context_sha) {
      throw new Error(
        `CONTEXT_CONFLICT: ${operation.branch} changed from ${operation.base_context_sha} to ${currentHead}`,
      )
    }
  }
  for (const change of operation.changes) {
    const current = await gh.getFile(token, operation.repository.owner, operation.repository.repo, change.path, operation.branch)
    if (change.action === 'create') {
      if (current) throw new Error(`BASE_CONFLICT: ${change.path} now exists on ${operation.branch}`)
    } else if (!current) {
      throw new Error(`BASE_CONFLICT: ${change.path} no longer exists on ${operation.branch}`)
    } else if (current.sha !== change.base_sha) {
      throw new Error(`BASE_CONFLICT: ${change.path} changed from ${change.base_sha} to ${current.sha}`)
    }
  }
}

function deliveryChanges(operation: ApprovalOperation) {
  return operation.changes.map((change) => ({
    path: change.path,
    content: change.proposed_content ?? undefined,
    delete: change.action === 'delete',
  }))
}

function taskResult(task: TaskRecord) {
  return {
    task_id: task.task_id,
    kind: task.kind,
    workflow: task.workflow,
    status: task.status,
    conclusion: task.conclusion ?? null,
    run_id: task.run_id ?? null,
    run_url: task.run_url ?? null,
    created_at: task.created_at,
    started_at: task.started_at ?? null,
    completed_at: task.completed_at ?? null,
    error: task.error ?? null,
  }
}

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/PROTECTED_BRANCH/.test(message)) return { code: 'PROTECTED_BRANCH', message, retryable: false, action_required: 'Use an agent/<task> working branch.' }
  if (/BASE_CONFLICT|BRANCH_CONFLICT|CONTEXT_CONFLICT/.test(message)) return { code: 'CONFLICT', message, retryable: false, action_required: 'Read the latest branch files and create a new staged approval operation.' }
  if (/status approved|status commit_prepared|status pushed|must be approved|must be pushed/i.test(message)) {
    return { code: 'INVALID_OPERATION_STATE', message, retryable: false, action_required: 'Complete approval, commit, push, build, and test in the required order.' }
  }
  if (/workflow.*not configured/i.test(message)) return { code: 'WORKFLOW_NOT_CONFIGURED', message, retryable: false, action_required: 'Add the workflow filename to PROJECTS_JSON and repository workflows.' }
  if (/404|not found/i.test(message)) return { code: 'NOT_FOUND', message, retryable: false, action_required: 'Verify project, operation, task, branch, workflow, and permissions.' }
  if (/403|rate limit/i.test(message)) return { code: 'FORBIDDEN_OR_RATE_LIMITED', message, retryable: true, action_required: 'Check GitHub token permissions and rate limits.' }
  if (/5\d\d/.test(message)) return { code: 'UPSTREAM_UNAVAILABLE', message, retryable: true, action_required: 'Retry after a short delay.' }
  return { code: 'DELIVERY_TOOL_FAILED', message, retryable: false, action_required: 'Inspect the exact error and BestCode Worker logs.' }
}

async function validateAssociatedOperation(env: Env, project: ProjectConfig, branch: string, operationId: unknown): Promise<void> {
  if (typeof operationId !== 'string' || !operationId.trim()) return
  const operation = await getApproval(env, operationId.trim())
  assertProject(operation, project)
  if (operation.branch !== branch) throw new Error('Associated operation branch does not match the task branch')
  if (operation.status !== 'pushed' && operation.status !== 'pull_request_opened') {
    throw new Error(`Associated operation must be pushed; current status is ${operation.status}`)
  }
}

async function startWorkflowTask(
  env: Env,
  token: string,
  project: ProjectConfig,
  branch: string,
  kind: TaskKind,
  workflow: string | undefined,
  operationId: unknown,
): Promise<TaskRecord> {
  if (!workflow) throw new Error(`${kind} workflow is not configured for ${project.id}`)
  await validateAssociatedOperation(env, project, branch, operationId)
  const now = new Date().toISOString()
  const task: TaskRecord = {
    task_id: crypto.randomUUID(),
    kind,
    project_id: project.id,
    repository: repo(project),
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

async function assertSuccessfulTasks(env: Env, project: ProjectConfig, operation: ApprovalOperation): Promise<void> {
  const tasks = await listTasks(env, { projectId: project.id, limit: 100 })
  const after = Date.parse(operation.pushed_at ?? operation.updated_at)
  for (const [kind, workflow] of [['build', project.buildWorkflow], ['test', project.testWorkflow]] as const) {
    if (!workflow) continue
    const task = tasks.items.find(
      (item) => item.kind === kind && item.branch === operation.branch && Date.parse(item.created_at) >= after,
    )
    if (!task || task.status !== 'completed' || task.conclusion !== 'success') {
      throw new Error(`${kind} must be completed successfully after the approved push before creating a pull request`)
    }
  }
}

export async function executeDeliveryMcpTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
): Promise<DeliveryToolResult> {
  const callId = crypto.randomUUID()
  let project: ProjectConfig | undefined
  let branch: string | undefined

  try {
    project = getProject(env, requireString(args, 'project_id'))

    if (name === 'repository_commit') {
      const operation = await getApproval(env, requireString(args, 'operation_id'))
      assertProject(operation, project)
      assertWorkingBranch(operation.branch)
      if (operation.status !== 'approved') throw new Error(`Operation must be approved; current status is ${operation.status}`)
      try {
        await assertBaseShas(token, operation)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/BASE_CONFLICT|CONTEXT_CONFLICT/.test(message)) {
          await markSuperseded(env, operation.operation_id, message)
        }
        throw error
      }
      const message = typeof args.message === 'string' && args.message.trim() ? args.message.trim() : operation.title
      const prepared = await prepareCommit(
        token,
        project.owner,
        project.repo,
        operation.branch,
        message,
        deliveryChanges(operation),
      )
      const updated = await markCommitPrepared(env, operation.operation_id, {
        parentSha: prepared.parentSha,
        commitSha: prepared.sha,
        commitUrl: prepared.url,
      })
      return finish({
        ok: true,
        operation_id: updated.operation_id,
        status: updated.status,
        project_id: project.id,
        repository: repo(project),
        branch: updated.branch,
        result: {
          commit_sha: prepared.sha,
          commit_url: prepared.url,
          parent_sha: prepared.parentSha,
          changed_files: prepared.changedFiles,
          branch_ref_updated: false,
          next_action: 'Call repository_push to fast-forward the working branch.',
        },
      })
    }

    if (name === 'repository_push') {
      const operation = await getApproval(env, requireString(args, 'operation_id'))
      assertProject(operation, project)
      assertWorkingBranch(operation.branch)
      if (operation.status !== 'commit_prepared' || !operation.prepared_commit_sha || !operation.parent_sha) {
        throw new Error(`Operation must be in status commit_prepared; current status is ${operation.status}`)
      }
      await pushPreparedCommit(
        token,
        project.owner,
        project.repo,
        operation.branch,
        operation.prepared_commit_sha,
        operation.parent_sha,
      )
      const updated = await markPushed(env, operation.operation_id)
      return finish({
        ok: true,
        operation_id: updated.operation_id,
        status: updated.status,
        project_id: project.id,
        repository: repo(project),
        branch: updated.branch,
        result: {
          commit_sha: updated.prepared_commit_sha,
          commit_url: updated.prepared_commit_url,
          pushed_at: updated.pushed_at,
          next_action: 'Run build_start and test_start for this branch.',
        },
      })
    }

    if (name === 'repository_create_pull_request') {
      const operation = await getApproval(env, requireString(args, 'operation_id'))
      assertProject(operation, project)
      if (operation.status !== 'pushed') throw new Error(`Operation must be pushed; current status is ${operation.status}`)
      await assertSuccessfulTasks(env, project, operation)
      const base = typeof args.base === 'string' && args.base.trim() ? args.base.trim() : project.defaultBranch
      const result = await agentGit.createPullRequest(token, project.owner, project.repo, {
        title: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : operation.title,
        head: operation.branch,
        base,
        body: typeof args.body === 'string' ? args.body : operation.summary,
        draft: args.draft !== false,
      })
      const updated = await markPullRequest(env, operation.operation_id, { number: result.number, url: result.url })
      return finish({
        ok: true,
        operation_id: updated.operation_id,
        status: updated.status,
        project_id: project.id,
        repository: repo(project),
        branch: updated.branch,
        result: { number: result.number, url: result.url, draft: result.draft, base, head: operation.branch },
      })
    }

    if (name === 'build_start' || name === 'test_start') {
      branch = requireString(args, 'branch')
      assertWorkingBranch(branch)
      const kind: TaskKind = name === 'build_start' ? 'build' : 'test'
      const workflow = kind === 'build' ? project.buildWorkflow : project.testWorkflow
      const task = await startWorkflowTask(env, token, project, branch, kind, workflow, args.operation_id)
      return finish({
        ok: true,
        operation_id: callId,
        task_id: task.task_id,
        status: task.status,
        project_id: project.id,
        repository: repo(project),
        branch,
        result: taskResult(task),
      })
    }

    if (name === 'build_status' || name === 'test_status' || name === 'task_get') {
      const task = await refreshWorkflowTask(env, token, requireString(args, 'task_id'))
      if (task.project_id !== project.id) throw new Error('Task not found for this project')
      const expectedKind = name === 'build_status' ? 'build' : name === 'test_status' ? 'test' : null
      if (expectedKind && task.kind !== expectedKind) throw new Error(`Task is ${task.kind}, not ${expectedKind}`)
      return finish({
        ok: true,
        operation_id: callId,
        task_id: task.task_id,
        status: task.status,
        project_id: project.id,
        repository: repo(project),
        branch: task.branch,
        result: taskResult(task),
      })
    }

    if (name === 'build_logs') {
      const offset = typeof args.offset === 'number' ? args.offset : 0
      const limit = typeof args.limit === 'number' ? args.limit : 30_000
      const result = await readTaskLogs(env, token, requireString(args, 'task_id'), offset, limit)
      if (result.task.project_id !== project.id || result.task.kind !== 'build') throw new Error('Build task not found for this project')
      return finish({
        ok: true,
        operation_id: callId,
        task_id: result.task.task_id,
        status: result.task.status,
        project_id: project.id,
        repository: repo(project),
        branch: result.task.branch,
        result: {
          task: taskResult(result.task),
          jobs: result.jobs,
          content: result.content,
          next_offset: result.next_offset,
          total_chars: result.total_chars,
        },
      })
    }

    if (name === 'task_cancel') {
      const task = await getTask(env, requireString(args, 'task_id'))
      if (task.project_id !== project.id) throw new Error('Task not found for this project')
      const cancelled = await cancelWorkflowTask(env, token, task.task_id)
      return finish({
        ok: true,
        operation_id: callId,
        task_id: cancelled.task_id,
        status: cancelled.status,
        project_id: project.id,
        repository: repo(project),
        branch: cancelled.branch,
        result: taskResult(cancelled),
      })
    }

    if (name === 'preview_get') {
      branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : project.defaultBranch
      return finish({
        ok: true,
        operation_id: callId,
        status: project.previewUrl ? 'available' : 'unavailable',
        project_id: project.id,
        repository: repo(project),
        branch,
        result: project.previewUrl
          ? { url: project.previewUrl, configured: true }
          : { url: null, configured: false, reason: 'No previewUrl is configured for this project.' },
      })
    }

    throw new Error(`Unknown delivery MCP tool: ${name}`)
  } catch (error) {
    return finish({
      ok: false,
      operation_id: callId,
      status: 'failed',
      ...(project ? { project_id: project.id, repository: repo(project) } : {}),
      ...(branch ? { branch } : {}),
      error: classify(error),
    })
  }
}
