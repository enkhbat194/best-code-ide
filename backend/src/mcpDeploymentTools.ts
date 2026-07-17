import {
  createApproval,
  createTask,
  getApproval,
  getTask,
  markDeploymentFinished,
  markDeploymentStarted,
  updateTask,
} from './approvalClient'
import type { ApprovalOperation, TaskRecord } from './approvalStore'
import { getProject, type ProjectConfig } from './projects'
import { dispatchWorkflow, readTaskLogs, refreshWorkflowTask } from './workflowRunner'
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
    approval_required: { type: 'boolean' },
    result: { type: 'object' },
    error: { type: 'object' },
  },
  required: ['ok', 'operation_id', 'status'],
} as const

const writeAnnotations = {
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
    description: 'Without approval_operation_id, create a high-risk deployment approval request. With an approved deployment operation, dispatch the configured GitHub Actions deployment workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string', description: 'Must equal the project default branch.' },
        target: { type: 'string', enum: ['backend', 'frontend', 'all'], default: 'all' },
        approval_operation_id: { type: 'string' },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'deployment_status',
    title: 'Get deployment status',
    description: 'Refresh deployment workflow status by task ID or deployment approval operation ID.',
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
    description: 'Read bounded paginated GitHub Actions logs for a deployment task.',
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

function target(args: Record<string, unknown>): 'backend' | 'frontend' | 'all' {
  const value = typeof args.target === 'string' ? args.target : 'all'
  if (value !== 'backend' && value !== 'frontend' && value !== 'all') throw new Error('target must be backend, frontend, or all')
  return value
}

function publicTask(task: TaskRecord) {
  return {
    task_id: task.task_id,
    operation_id: task.operation_id ?? null,
    workflow: task.workflow,
    branch: task.branch,
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
  if (/not configured/i.test(message)) return { code: 'DEPLOYMENT_NOT_CONFIGURED', message, retryable: false, action_required: 'Configure deployWorkflow in PROJECTS_JSON and add the workflow file and required GitHub secrets.' }
  if (/must equal the project default branch/i.test(message)) return { code: 'INVALID_DEPLOYMENT_BRANCH', message, retryable: false, action_required: 'Merge reviewed changes, then deploy the project default branch.' }
  if (/must be approved|purpose|already started/i.test(message)) return { code: 'APPROVAL_REQUIRED', message, retryable: false, action_required: 'Review and approve the deployment operation in the BestCode PWA.' }
  if (/404|not found/i.test(message)) return { code: 'NOT_FOUND', message, retryable: false, action_required: 'Verify project, workflow, operation ID, task ID, and GitHub permissions.' }
  if (/403|rate limit/i.test(message)) return { code: 'FORBIDDEN_OR_RATE_LIMITED', message, retryable: true, action_required: 'Check GitHub Actions permission and rate limits.' }
  if (/5\d\d/.test(message)) return { code: 'UPSTREAM_UNAVAILABLE', message, retryable: true, action_required: 'Retry after a short delay.' }
  return { code: 'DEPLOYMENT_TOOL_FAILED', message, retryable: false, action_required: 'Inspect the exact workflow error and BestCode Worker logs.' }
}

async function createDeploymentApproval(
  env: Env,
  project: ProjectConfig,
  branch: string,
  deployTarget: 'backend' | 'frontend' | 'all',
): Promise<ApprovalOperation> {
  const now = new Date()
  const operation: ApprovalOperation = {
    operation_id: crypto.randomUUID(),
    purpose: 'deployment',
    project_id: project.id,
    repository: repository(project),
    branch,
    title: `Deploy ${project.name} (${deployTarget})`,
    summary: `Production deployment request for ${project.owner}/${project.repo} from ${branch}. Target: ${deployTarget}.`,
    status: 'pending_approval',
    approval_required: true,
    risk: 'high',
    risk_reasons: ['production_deployment'],
    changes: [],
    deployment_target: deployTarget,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  }
  return createApproval(env, operation)
}

async function resolveDeploymentTask(env: Env, args: Record<string, unknown>): Promise<TaskRecord> {
  if (typeof args.task_id === 'string' && args.task_id.trim()) return getTask(env, args.task_id.trim())
  const operationId = requireString(args, 'approval_operation_id')
  const operation = await getApproval(env, operationId)
  if (!operation.deployment_task_id) throw new Error('Deployment has not started yet')
  return getTask(env, operation.deployment_task_id)
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
      const deployTarget = target(args)
      const approvalId = typeof args.approval_operation_id === 'string' ? args.approval_operation_id.trim() : ''

      if (!approvalId) {
        const operation = await createDeploymentApproval(env, project, branch, deployTarget)
        return finish({
          ok: true,
          operation_id: operation.operation_id,
          status: operation.status,
          project_id: project.id,
          repository: repository(project),
          branch,
          approval_required: true,
          result: {
            purpose: operation.purpose,
            target: deployTarget,
            risk: operation.risk,
            risk_reasons: operation.risk_reasons,
            expires_at: operation.expires_at,
            next_action: 'The user must approve this production deployment in the BestCode PWA.',
          },
        })
      }

      const operation = await getApproval(env, approvalId)
      if (operation.project_id !== project.id || operation.branch !== branch || operation.purpose !== 'deployment') {
        throw new Error('Deployment approval does not belong to this project, branch, and purpose')
      }
      if (operation.status !== 'approved') throw new Error(`Deployment operation must be approved; current status is ${operation.status}`)
      if (operation.deployment_target !== deployTarget) throw new Error('Deployment target does not match the approved request')
      if (operation.deployment_task_id) throw new Error(`Deployment already started as task ${operation.deployment_task_id}`)

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
        await dispatchWorkflow(token, project.owner, project.repo, project.deployWorkflow, branch, { target: deployTarget })
        await markDeploymentStarted(env, operation.operation_id, task.task_id)
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
          target: deployTarget,
          task: publicTask(task),
          next_action: 'Call deployment_status until the workflow completes, then inspect deployment_logs.',
        },
      })
    }

    if (name === 'deployment_status') {
      const task = await resolveDeploymentTask(env, args)
      if (task.project_id !== project.id || task.kind !== 'deployment') throw new Error('Deployment task not found for this project')
      const refreshed = await refreshWorkflowTask(env, token, task.task_id)
      if (refreshed.operation_id && (refreshed.status === 'completed' || refreshed.status === 'failed' || refreshed.status === 'cancelled')) {
        const operation = await getApproval(env, refreshed.operation_id)
        if (operation.status === 'deployment_started') {
          await markDeploymentFinished(env, operation.operation_id, refreshed.status === 'completed' && refreshed.conclusion === 'success')
        }
      }
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
