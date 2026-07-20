import * as gh from './github'
import { createApproval, createTask, getApproval, getTask, listTasks, markSuperseded, updateTask } from './approvalClient'
import type { ApprovalOperation, TaskRecord } from './approvalStore'
import { getProject, type ProjectConfig } from './projects'
import { dispatchWorkflow, readTaskLogs, refreshWorkflowTask } from './workflowRunner'
import type { Env } from './types'

const DEPLOYMENT_REASON = 'production_deployment'
const APPROVAL_TTL_MS = 60 * 60 * 1000

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
    approval_required: { type: 'boolean' },
    result: { type: 'object' },
    error: { type: 'object' },
  },
  required: ['ok', 'operation_id', 'status'],
} as const

const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

export const deploymentMcpTools = [
  {
    name: 'deployment_start',
    title: 'Request or start production deployment',
    description:
      'Without approval_operation_id, create a separate high-risk deployment approval. With an approved deployment operation, dispatch the configured GitHub Actions deploy workflow from the project default branch.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string', description: 'Must equal the project default branch.' },
        target: { type: 'string', enum: ['backend', 'frontend', 'all'], default: 'backend' },
        approval_operation_id: { type: 'string' },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: destructiveAnnotations,
  },
  {
    name: 'deployment_status',
    title: 'Get deployment status',
    description: 'Refresh a deployment workflow task by task ID or deployment approval operation ID.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        task_id: { type: 'string' },
        approval_operation_id: { type: 'string' },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'deployment_logs',
    title: 'Read deployment logs',
    description: 'Read bounded, paginated GitHub Actions logs for a deployment task.',
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
] as const

interface ToolEnvelope {
  ok: boolean
  operation_id: string
  task_id?: string
  status: string
  project_id?: string
  repository?: { owner: string; repo: string; full_name: string }
  branch?: string
  approval_required?: boolean
  result?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean; action_required: string }
}

export interface DeploymentToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: ToolEnvelope
  isError?: boolean
}

function finish(envelope: ToolEnvelope): DeploymentToolResult {
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

function repository(project: ProjectConfig) {
  return { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` }
}

function deploymentTarget(args: Record<string, unknown>): 'backend' | 'frontend' | 'all' {
  const value = typeof args.target === 'string' && args.target.trim() ? args.target.trim() : 'backend'
  if (value !== 'backend' && value !== 'frontend' && value !== 'all') {
    throw new Error('target must be backend, frontend, or all')
  }
  return value
}

function targetReason(target: 'backend' | 'frontend' | 'all'): string {
  return `deployment_target:${target}`
}

function publicTask(task: TaskRecord) {
  return {
    task_id: task.task_id,
    kind: task.kind,
    project_id: task.project_id,
    operation_id: task.operation_id ?? null,
    repository: task.repository,
    workflow: task.workflow,
    branch: task.branch,
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

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/DEPLOYMENT_CONTEXT_STALE/.test(message)) {
    return {
      code: 'DEPLOYMENT_CONTEXT_STALE',
      message,
      retryable: false,
      action_required: 'Create and approve a new deployment operation for the current main SHA.',
    }
  }
  if (/not configured/i.test(message)) {
    return {
      code: 'DEPLOYMENT_NOT_CONFIGURED',
      message,
      retryable: false,
      action_required: 'Configure deployWorkflow in PROJECTS_JSON and add deploy.yml plus Cloudflare GitHub secrets.',
    }
  }
  if (/default branch/i.test(message)) {
    return {
      code: 'INVALID_DEPLOYMENT_BRANCH',
      message,
      retryable: false,
      action_required: 'Merge reviewed changes first, then deploy the project default branch.',
    }
  }
  if (/approval|approved|already has/i.test(message)) {
    return {
      code: 'DEPLOYMENT_APPROVAL_REQUIRED',
      message,
      retryable: false,
      action_required: 'Review and approve the exact production deployment operation in BestCode.',
    }
  }
  if (/404|not found/i.test(message)) {
    return {
      code: 'NOT_FOUND',
      message,
      retryable: false,
      action_required: 'Verify project, workflow, operation ID, task ID, and GitHub permissions.',
    }
  }
  if (/403|rate limit/i.test(message)) {
    return {
      code: 'FORBIDDEN_OR_RATE_LIMITED',
      message,
      retryable: true,
      action_required: 'Check GitHub Actions permission and rate limits.',
    }
  }
  if (/5\d\d/.test(message)) {
    return {
      code: 'UPSTREAM_UNAVAILABLE',
      message,
      retryable: true,
      action_required: 'Retry after a short delay.',
    }
  }
  return {
    code: 'DEPLOYMENT_TOOL_FAILED',
    message,
    retryable: false,
    action_required: 'Inspect the exact deployment task and GitHub Actions logs.',
  }
}

async function createDeploymentApproval(
  env: Env,
  token: string,
  project: ProjectConfig,
  branch: string,
  target: 'backend' | 'frontend' | 'all',
): Promise<ApprovalOperation> {
  const branchContext = await gh.getBranch(token, project.owner, project.repo, branch)
  if (!branchContext) throw new Error(`Deployment branch not found: ${branch}`)
  const now = new Date()
  const operation: ApprovalOperation = {
    operation_id: crypto.randomUUID(),
    project_id: project.id,
    repository: repository(project),
    branch,
    title: `Deploy ${project.name} (${target})`,
    summary: `Production deployment request for ${project.owner}/${project.repo} from ${branch}. Target: ${target}.`,
    status: 'pending_approval',
    approval_required: true,
    risk: 'high',
    risk_reasons: [DEPLOYMENT_REASON, targetReason(target)],
    changes: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    base_context_sha: branchContext.sha,
  }
  return createApproval(env, operation)
}

function assertDeploymentApproval(
  operation: ApprovalOperation,
  project: ProjectConfig,
  branch: string,
  target: 'backend' | 'frontend' | 'all',
): void {
  const matches =
    operation.project_id === project.id &&
    operation.repository.owner === project.owner &&
    operation.repository.repo === project.repo &&
    operation.branch === branch &&
    operation.changes.length === 0 &&
    operation.risk === 'high' &&
    operation.risk_reasons.includes(DEPLOYMENT_REASON) &&
    operation.risk_reasons.includes(targetReason(target))

  if (!matches) throw new Error('Deployment approval does not match this project, branch, and target')
  if (operation.status !== 'approved') {
    throw new Error(`Deployment operation must be approved; current status is ${operation.status}`)
  }
}

async function taskForOperation(env: Env, projectId: string, operationId: string): Promise<TaskRecord | null> {
  const result = await listTasks(env, { projectId, operationId, kind: 'deployment', limit: 50 })
  return result.items[0] ?? null
}

async function resolveDeploymentTask(
  env: Env,
  project: ProjectConfig,
  args: Record<string, unknown>,
): Promise<TaskRecord> {
  if (typeof args.task_id === 'string' && args.task_id.trim()) return getTask(env, args.task_id.trim())
  const operationId = requireString(args, 'approval_operation_id')
  const task = await taskForOperation(env, project.id, operationId)
  if (!task) throw new Error('Deployment task not found for the approval operation')
  return task
}

export async function executeDeploymentMcpTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
): Promise<DeploymentToolResult> {
  const callId = crypto.randomUUID()
  let project: ProjectConfig | undefined
  let branch: string | undefined

  try {
    project = getProject(env, requireString(args, 'project_id'))

    if (name === 'deployment_start') {
      if (!project.deployWorkflow) throw new Error(`Deployment workflow is not configured for ${project.id}`)
      branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : project.defaultBranch
      if (branch !== project.defaultBranch) throw new Error('Deployment branch must equal the project default branch')

      const target = deploymentTarget(args)
      const approvalId = typeof args.approval_operation_id === 'string' ? args.approval_operation_id.trim() : ''

      if (!approvalId) {
        const operation = await createDeploymentApproval(env, token, project, branch, target)
        return finish({
          ok: true,
          operation_id: operation.operation_id,
          status: operation.status,
          project_id: project.id,
          repository: repository(project),
          branch,
          approval_required: true,
          result: {
            target,
            risk: operation.risk,
            risk_reasons: operation.risk_reasons,
            expires_at: operation.expires_at,
            source_sha: operation.base_context_sha,
            next_action: 'The user must approve this production deployment in the BestCode Changes screen.',
          },
        })
      }

      const operation = await getApproval(env, approvalId)
      assertDeploymentApproval(operation, project, branch, target)
      if (operation.base_context_sha) {
        const current = await gh.getBranch(token, project.owner, project.repo, branch)
        if (!current || current.sha !== operation.base_context_sha) {
          const currentSha = current?.sha ?? 'missing'
          const reason = `DEPLOYMENT_CONTEXT_STALE: ${branch} changed from ${operation.base_context_sha} to ${currentSha}`
          await markSuperseded(env, operation.operation_id, reason)
          throw new Error(reason)
        }
      }

      const existing = await taskForOperation(env, project.id, operation.operation_id)
      if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') {
        throw new Error(`Deployment approval already has task ${existing.task_id}`)
      }

      const now = new Date().toISOString()
      const task: TaskRecord = {
        task_id: crypto.randomUUID(),
        kind: 'deployment',
        project_id: project.id,
        operation_id: operation.operation_id,
        repository: repository(project),
        branch,
        workflow: project.deployWorkflow,
        status: 'queued',
        created_at: now,
        updated_at: now,
      }
      await createTask(env, task)

      try {
        await dispatchWorkflow(token, project.owner, project.repo, project.deployWorkflow, branch, { target })
      } catch (error) {
        await updateTask(env, task.task_id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }

      return finish({
        ok: true,
        operation_id: operation.operation_id,
        task_id: task.task_id,
        status: task.status,
        project_id: project.id,
        repository: repository(project),
        branch,
        approval_required: false,
        result: {
          target,
          task: publicTask(task),
          next_action: 'Call deployment_status until completion, then inspect deployment_logs.',
        },
      })
    }

    if (name === 'deployment_status') {
      const task = await resolveDeploymentTask(env, project, args)
      if (task.project_id !== project.id || task.kind !== 'deployment') {
        throw new Error('Deployment task not found for this project')
      }
      const refreshed = await refreshWorkflowTask(env, token, task.task_id)
      return finish({
        ok: true,
        operation_id: refreshed.operation_id ?? callId,
        task_id: refreshed.task_id,
        status: refreshed.status,
        project_id: project.id,
        repository: repository(project),
        branch: refreshed.branch,
        result: publicTask(refreshed),
      })
    }

    if (name === 'deployment_logs') {
      const taskId = requireString(args, 'task_id')
      const offset = typeof args.offset === 'number' ? args.offset : 0
      const limit = typeof args.limit === 'number' ? args.limit : 30_000
      const logs = await readTaskLogs(env, token, taskId, offset, limit)
      if (logs.task.project_id !== project.id || logs.task.kind !== 'deployment') {
        throw new Error('Deployment task not found for this project')
      }
      return finish({
        ok: true,
        operation_id: logs.task.operation_id ?? callId,
        task_id: logs.task.task_id,
        status: logs.task.status,
        project_id: project.id,
        repository: repository(project),
        branch: logs.task.branch,
        result: {
          task: publicTask(logs.task),
          jobs: logs.jobs,
          content: logs.content,
          next_offset: logs.next_offset,
          total_chars: logs.total_chars,
        },
      })
    }

    throw new Error(`Unknown deployment MCP tool: ${name}`)
  } catch (error) {
    return finish({
      ok: false,
      operation_id: callId,
      status: 'failed',
      ...(project ? { project_id: project.id, repository: repository(project) } : {}),
      ...(branch ? { branch } : {}),
      error: classify(error),
    })
  }
}
