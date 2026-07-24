import * as gh from './github'
import { createApproval, getApproval, listApprovals, markCompleted, markSuperseded } from './approvalClient'
import type { ApprovalOperation, RiskLevel, StagedChange } from './approvalStore'
import { createUnifiedDiff, applyUnifiedPatch } from './patch'
import { getProject, type ProjectConfig } from './projects'
import type { Env } from './types'

const MAX_FILE_CHARS = 500_000
const OPERATION_TTL_MS = 24 * 60 * 60 * 1000

const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    operation_id: { type: 'string' },
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
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
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
  openWorldHint: false,
} as const

export const safeWriteMcpTools = [
  {
    name: 'repository_create_branch',
    title: 'Create working branch',
    description: 'Create a safe non-protected working branch. This is the only repository write allowed before a staged approval operation exists.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string', description: 'Working branch name, normally agent/<task>.' },
        from_branch: { type: 'string', description: 'Source branch; defaults to the project default branch.' },
      },
      required: ['project_id', 'name'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'repository_write_file',
    title: 'Stage complete file content',
    description: 'Stage creation or full replacement of one UTF-8 file. It does not commit or push. It returns a pending approval operation and diff.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string', maxLength: MAX_FILE_CHARS },
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['project_id', 'branch', 'path', 'content'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'repository_apply_patch',
    title: 'Stage unified patch',
    description: 'Validate and stage a single-file unified diff against the exact current branch content. It does not commit or push and requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        path: { type: 'string' },
        patch: { type: 'string', maxLength: 250000 },
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['project_id', 'branch', 'path', 'patch'],
    },
    outputSchema,
    annotations: writeAnnotations,
  },
  {
    name: 'repository_delete_file',
    title: 'Stage file deletion',
    description: 'Stage deletion of one file. No GitHub change occurs until a later approved delivery phase. Approval is always required.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        path: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['project_id', 'branch', 'path'],
    },
    outputSchema,
    annotations: destructiveAnnotations,
  },

  {
    name: 'repository_delete_branch',
    title: 'Delete repository branch',
    description: 'Create a high-risk branch-deletion approval, then delete only the unchanged approved non-default, non-protected branch.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        approval_operation_id: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['project_id', 'branch'],
    },
    outputSchema,
    annotations: destructiveAnnotations,
  },
  {
    name: 'repository_diff',
    title: 'Read staged operation diff',
    description: 'Read the exact staged diff and approval state for one BestCode operation.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, operation_id: { type: 'string' } },
      required: ['project_id', 'operation_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'repository_status',
    title: 'List staged repository operations',
    description: 'List recent staged operations and their approval status for one project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'approval_get',
    title: 'Get approval request',
    description: 'Read one approval operation. Decisions must be made through the authenticated BestCode approval UI or REST endpoint, not by the AI tool itself.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, operation_id: { type: 'string' } },
      required: ['project_id', 'operation_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
] as const

interface ToolEnvelope {
  ok: boolean
  operation_id: string
  status: string
  project_id?: string
  repository?: { owner: string; repo: string; full_name: string }
  branch?: string
  approval_required?: boolean
  result?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean; action_required: string }
}

export interface McpWriteToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: ToolEnvelope
  isError?: boolean
}

function finish(envelope: ToolEnvelope): McpWriteToolResult {
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

function repoFields(project: ProjectConfig) {
  return { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` }
}

function protectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master'
}

function validateWorkingBranch(branch: string): void {
  if (protectedBranch(branch)) throw new Error('PROTECTED_BRANCH: main/master cannot receive staged write operations')
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/')) {
    throw new Error('INVALID_BRANCH: branch contains unsupported characters or structure')
  }
}

function normalizePath(value: string): string {
  const path = value.trim().replace(/^\/+/, '')
  if (!path || path.length > 240) throw new Error('INVALID_PATH: path is required and must be at most 240 characters')
  if (path.split('/').some((part) => part === '..' || part === '.')) throw new Error('INVALID_PATH: relative path segments are not allowed')
  if (path.startsWith('.git/')) throw new Error('INVALID_PATH: .git paths are not accessible')
  return path
}

function riskForPath(path: string, action: StagedChange['action']): { risk: RiskLevel; reasons: string[] } {
  const reasons: string[] = []
  if (action === 'delete') reasons.push('file_deletion')
  if (path.startsWith('.github/workflows/')) reasons.push('workflow_change')
  if (/(^|\/)(\.env|wrangler\.toml|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(path)) {
    reasons.push('configuration_or_dependency_change')
  }
  if (/(^|\/)(migrations?|schema|database)(\/|\.|$)/i.test(path)) reasons.push('database_or_migration_path')
  if (/secret|credential|token|private[-_]?key/i.test(path)) reasons.push('sensitive_path_name')
  if (
    path === 'BESTCODE_MASTER.md' ||
    path === 'docs/PROJECT_STATUS.md' ||
    path === 'docs/ARCHITECTURE.md' ||
    path === 'docs/ROADMAP.md' ||
    path.startsWith('docs/DECISIONS/')
  ) {
    reasons.push('project_brain_source_of_truth_change')
  }
  return { risk: reasons.length > 0 ? 'high' : 'normal', reasons }
}

function operationTitle(args: Record<string, unknown>, fallback: string): string {
  return typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : fallback
}

function operationSummary(args: Record<string, unknown>, fallback: string): string {
  return typeof args.summary === 'string' && args.summary.trim() ? args.summary.trim().slice(0, 1000) : fallback
}


const BRANCH_DELETION_REASON = 'branch_deletion'

function branchReason(branch: string): string {
  return `target_branch:${branch}`
}

function branchShaReason(sha: string): string {
  return `target_sha:${sha}`
}

function assertBranchDeletionOperation(
  operation: ApprovalOperation,
  project: ProjectConfig,
  branch: string,
): void {
  const matches =
    operation.project_id === project.id &&
    operation.repository.owner === project.owner &&
    operation.repository.repo === project.repo &&
    operation.branch === branch &&
    operation.changes.length === 0 &&
    operation.risk === 'high' &&
    operation.risk_reasons.includes(BRANCH_DELETION_REASON) &&
    operation.risk_reasons.includes(branchReason(branch)) &&
    operation.risk_reasons.some((reason) => reason.startsWith('target_sha:'))
  if (!matches) throw new Error('BRANCH_DELETE_APPROVAL_MISMATCH: approval does not match the current project and branch')
}

function validateDeletableBranch(branch: string, project: ProjectConfig): void {
  validateWorkingBranch(branch)
  if (branch === project.defaultBranch || protectedBranch(branch)) {
    throw new Error('PROTECTED_BRANCH: the project default branch and main/master cannot be deleted')
  }
}

async function createBranchDeletionApproval(
  env: Env,
  project: ProjectConfig,
  branch: string,
  sha: string,
  args: Record<string, unknown>,
): Promise<McpWriteToolResult> {
  const now = new Date()
  const operation: ApprovalOperation = {
    operation_id: crypto.randomUUID(),
    project_id: project.id,
    repository: repoFields(project),
    branch,
    title: operationTitle(args, `Delete branch ${branch}`),
    summary: operationSummary(args, `Permanently delete branch ${branch} at ${sha}.`),
    status: 'pending_approval',
    approval_required: true,
    risk: 'high',
    risk_reasons: [BRANCH_DELETION_REASON, branchReason(branch), branchShaReason(sha)],
    changes: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + OPERATION_TTL_MS).toISOString(),
  }
  await createApproval(env, operation)
  return finish({
    ok: true,
    operation_id: operation.operation_id,
    status: operation.status,
    project_id: project.id,
    repository: repoFields(project),
    branch,
    approval_required: true,
    result: {
      branch,
      sha,
      risk: operation.risk,
      risk_reasons: operation.risk_reasons,
      expires_at: operation.expires_at,
      next_action: 'The user must approve this exact branch deletion in BestCode, then call repository_delete_branch again with approval_operation_id.',
    },
  })
}

async function assertBranchDeletionApproval(
  env: Env,
  operation: ApprovalOperation,
  project: ProjectConfig,
  branch: string,
  sha: string,
): Promise<void> {
  assertBranchDeletionOperation(operation, project, branch)
  if (operation.status !== 'approved') {
    throw new Error(`BRANCH_DELETE_APPROVAL_REQUIRED: operation must be approved; current status is ${operation.status}`)
  }
  if (!operation.risk_reasons.includes(branchShaReason(sha))) {
    await markSuperseded(
      env,
      operation.operation_id,
      `BRANCH_SHA_CHANGED: approved branch no longer points to the pinned SHA for ${branch}`,
    )
    throw new Error('BRANCH_DELETE_APPROVAL_MISMATCH: approval does not match the current branch SHA')
  }
}

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('BRANCH_DELETE_APPROVAL_MISMATCH')) {
    return { code: 'BRANCH_DELETE_APPROVAL_MISMATCH', message, retryable: false, action_required: 'Create a new deletion approval for the branch current SHA.' }
  }
  if (message.startsWith('BRANCH_DELETE_APPROVAL_REQUIRED')) {
    return { code: 'BRANCH_DELETE_APPROVAL_REQUIRED', message, retryable: false, action_required: 'Approve the exact branch deletion operation in BestCode.' }
  }
  if (message.startsWith('PROTECTED_BRANCH')) {
    return { code: 'PROTECTED_BRANCH', message, retryable: false, action_required: 'Call repository_create_branch and retry on the new working branch.' }
  }
  if (message.startsWith('INVALID_') || /required|exceeds|mismatch|contains no hunks/i.test(message)) {
    return { code: 'INVALID_ARGUMENT', message, retryable: false, action_required: 'Correct the branch, path, content, or patch and retry.' }
  }
  if (/not configured/i.test(message)) {
    return { code: 'APPROVAL_STORAGE_NOT_CONFIGURED', message, retryable: false, action_required: 'Deploy the Durable Object binding and migration from backend/wrangler.toml.' }
  }
  if (/404|not found/i.test(message)) {
    return { code: 'NOT_FOUND', message, retryable: false, action_required: 'Verify project, branch, operation ID, and file path.' }
  }
  if (/403|rate limit/i.test(message)) {
    return { code: 'GITHUB_FORBIDDEN_OR_RATE_LIMITED', message, retryable: true, action_required: 'Check GitHub permissions and rate limits.' }
  }
  if (/5\d\d/.test(message)) {
    return { code: 'UPSTREAM_UNAVAILABLE', message, retryable: true, action_required: 'Retry after a short delay.' }
  }
  return { code: 'WRITE_TOOL_FAILED', message, retryable: false, action_required: 'Inspect the exact error and Worker logs.' }
}

async function stageOperation(
  env: Env,
  token: string,
  project: ProjectConfig,
  branch: string,
  args: Record<string, unknown>,
  change: StagedChange,
): Promise<McpWriteToolResult> {
  const branchContext = await gh.getBranch(token, project.owner, project.repo, branch)
  if (!branchContext) throw new Error(`Branch not found: ${branch}`)
  const operationId = crypto.randomUUID()
  const now = new Date()
  const risk = riskForPath(change.path, change.action)
  const operation: ApprovalOperation = {
    operation_id: operationId,
    project_id: project.id,
    repository: repoFields(project),
    branch,
    title: operationTitle(args, `${change.action} ${change.path}`),
    summary: operationSummary(args, `Review the proposed ${change.action} operation for ${change.path}.`),
    status: 'pending_approval',
    approval_required: true,
    risk: risk.risk,
    risk_reasons: risk.reasons,
    changes: [change],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + OPERATION_TTL_MS).toISOString(),
    base_context_sha: branchContext.sha,
  }
  await createApproval(env, operation)
  return finish({
    ok: true,
    operation_id: operationId,
    status: 'pending_approval',
    project_id: project.id,
    repository: repoFields(project),
    branch,
    approval_required: true,
    result: {
      title: operation.title,
      summary: operation.summary,
      risk: operation.risk,
      risk_reasons: operation.risk_reasons,
      expires_at: operation.expires_at,
      changes: operation.changes.map((item) => ({ action: item.action, path: item.path, base_sha: item.base_sha })),
      diff: change.diff,
      next_action: 'The user must approve this operation in BestCode before any commit or push tool can deliver it.',
    },
  })
}

function assertOperationProject(operation: ApprovalOperation, projectId: string): void {
  if (operation.project_id !== projectId) throw new Error('Operation not found for this project')
}

export async function executeSafeWriteMcpTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
): Promise<McpWriteToolResult> {
  const callOperationId = crypto.randomUUID()
  let project: ProjectConfig | undefined
  let branch: string | undefined

  try {
    project = getProject(env, requireString(args, 'project_id'))

    if (name === 'repository_create_branch') {
      const branchName = requireString(args, 'name')
      validateWorkingBranch(branchName)
      if (!branchName.startsWith('agent/')) throw new Error('INVALID_BRANCH: working branches must use the agent/<task> prefix')
      const from = typeof args.from_branch === 'string' && args.from_branch.trim() ? args.from_branch.trim() : project.defaultBranch
      if (typeof args.expected_base_sha === 'string' && args.expected_base_sha.trim()) {
        const source = await gh.getBranch(token, project.owner, project.repo, from)
        if (!source || source.sha !== args.expected_base_sha.trim().toLowerCase()) {
          throw new Error(`CONTEXT_CONFLICT: ${from} does not match expected base SHA`)
        }
      }
      const created = await gh.createBranch(token, project.owner, project.repo, branchName, from)
      return finish({
        ok: true,
        operation_id: callOperationId,
        status: 'completed',
        project_id: project.id,
        repository: repoFields(project),
        branch: created.name,
        approval_required: false,
        result: { name: created.name, sha: created.sha, protected: created.protected, from_branch: from },
      })
    }


    if (name === 'repository_delete_branch') {
      branch = requireString(args, 'branch')
      validateDeletableBranch(branch, project)
      const approvalId = typeof args.approval_operation_id === 'string' ? args.approval_operation_id.trim() : ''

      if (approvalId) {
        const operation = await getApproval(env, approvalId)
        if (operation.status === 'completed') {
          assertBranchDeletionOperation(operation, project, branch)
          return finish({
            ok: true,
            operation_id: operation.operation_id,
            status: operation.status,
            project_id: project.id,
            repository: repoFields(project),
            branch,
            approval_required: true,
            result: { branch, already_completed: true, completed_at: operation.completed_at ?? null },
          })
        }

        const current = await gh.getBranch(token, project.owner, project.repo, branch)
        if (!current) throw new Error(`Branch not found: ${branch}`)
        if (current.protected) throw new Error('PROTECTED_BRANCH: GitHub reports this branch as protected')
        await assertBranchDeletionApproval(env, operation, project, branch, current.sha)
        await gh.deleteBranch(token, project.owner, project.repo, branch)
        const completed = await markCompleted(env, operation.operation_id)
        return finish({
          ok: true,
          operation_id: completed.operation_id,
          status: completed.status,
          project_id: project.id,
          repository: repoFields(project),
          branch,
          approval_required: true,
          result: { branch, deleted_sha: current.sha, completed_at: completed.completed_at ?? null },
        })
      }

      const current = await gh.getBranch(token, project.owner, project.repo, branch)
      if (!current) throw new Error(`Branch not found: ${branch}`)
      if (current.protected) throw new Error('PROTECTED_BRANCH: GitHub reports this branch as protected')
      return createBranchDeletionApproval(env, project, branch, current.sha, args)
    }

    if (name === 'repository_diff' || name === 'approval_get') {
      const operation = await getApproval(env, requireString(args, 'operation_id'))
      assertOperationProject(operation, project.id)
      return finish({
        ok: true,
        operation_id: operation.operation_id,
        status: operation.status,
        project_id: project.id,
        repository: operation.repository,
        branch: operation.branch,
        approval_required: true,
        result: {
          title: operation.title,
          summary: operation.summary,
          risk: operation.risk,
          risk_reasons: operation.risk_reasons,
          created_at: operation.created_at,
          updated_at: operation.updated_at,
          expires_at: operation.expires_at,
          changes: operation.changes.map((change) => ({
            action: change.action,
            path: change.path,
            base_sha: change.base_sha,
            diff: change.diff,
          })),
        },
      })
    }

    if (name === 'repository_status') {
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.floor(args.limit), 1), 100) : 30
      const result = await listApprovals(env, {
        projectId: project.id,
        status: typeof args.status === 'string' && args.status.trim() ? args.status.trim() : undefined,
        limit,
      })
      return finish({
        ok: true,
        operation_id: callOperationId,
        status: 'completed',
        project_id: project.id,
        repository: repoFields(project),
        approval_required: false,
        result: {
          items: result.items.map((operation) => ({
            operation_id: operation.operation_id,
            branch: operation.branch,
            title: operation.title,
            status: operation.status,
            risk: operation.risk,
            changed_paths: operation.changes.map((change) => change.path),
            created_at: operation.created_at,
            expires_at: operation.expires_at,
          })),
          count: result.count,
          total: result.total,
        },
      })
    }

    branch = requireString(args, 'branch')
    validateWorkingBranch(branch)
    const path = normalizePath(requireString(args, 'path'))
    if (typeof args.expected_branch_head_sha === 'string' && args.expected_branch_head_sha.trim()) {
      const currentBranch = await gh.getBranch(token, project.owner, project.repo, branch)
      if (!currentBranch || currentBranch.sha !== args.expected_branch_head_sha.trim().toLowerCase()) {
        throw new Error(`CONTEXT_CONFLICT: ${branch} head does not match expected SHA`)
      }
    }

    if (name === 'repository_write_file') {
      const content = typeof args.content === 'string' ? args.content : ''
      if (content.length > MAX_FILE_CHARS) throw new Error(`content exceeds the ${MAX_FILE_CHARS} character limit`)
      const existing = await gh.getFile(token, project.owner, project.repo, path, branch)
      if (typeof args.expected_old_hash === 'string' && args.expected_old_hash !== (existing?.sha ?? 'absent')) {
        throw new Error(`BASE_CONFLICT: ${path} does not match expected old hash`)
      }
      if (existing?.content === content) throw new Error('INVALID_ARGUMENT: proposed content is identical to the branch content')
      const action: StagedChange['action'] = existing ? 'update' : 'create'
      const diff = createUnifiedDiff(path, existing?.content ?? null, content)
      return stageOperation(env, token, project, branch, args, {
        action,
        path,
        base_sha: existing?.sha ?? null,
        base_content: existing?.content ?? null,
        proposed_content: content,
        diff,
      })
    }

    if (name === 'repository_apply_patch') {
      const patch = requireString(args, 'patch')
      const existing = await gh.getFile(token, project.owner, project.repo, path, branch)
      if (typeof args.expected_old_hash === 'string' && args.expected_old_hash !== (existing?.sha ?? 'absent')) {
        throw new Error(`BASE_CONFLICT: ${path} does not match expected old hash`)
      }
      if (!existing) throw new Error(`File not found: ${path}`)
      const applied = applyUnifiedPatch(existing.content, patch, path)
      if (applied.content === existing.content) throw new Error('INVALID_ARGUMENT: patch produces no content change')
      const diff = createUnifiedDiff(path, existing.content, applied.content)
      return stageOperation(env, token, project, branch, args, {
        action: 'update',
        path,
        base_sha: existing.sha,
        base_content: existing.content,
        proposed_content: applied.content,
        diff,
      })
    }

    if (name === 'repository_delete_file') {
      const existing = await gh.getFile(token, project.owner, project.repo, path, branch)
      if (!existing) throw new Error(`File not found: ${path}`)
      const diff = createUnifiedDiff(path, existing.content, null)
      return stageOperation(env, token, project, branch, args, {
        action: 'delete',
        path,
        base_sha: existing.sha,
        base_content: existing.content,
        proposed_content: null,
        diff,
      })
    }

    throw new Error(`Unknown safe write MCP tool: ${name}`)
  } catch (error) {
    const classified = classify(error)
    return finish({
      ok: false,
      operation_id: callOperationId,
      status: 'failed',
      ...(project ? { project_id: project.id, repository: repoFields(project) } : {}),
      ...(branch ? { branch } : {}),
      error: classified,
    })
  }
}
