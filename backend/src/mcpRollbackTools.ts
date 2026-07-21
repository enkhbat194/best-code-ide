import * as gh from './github'
import { createApproval } from './approvalClient'
import type { ApprovalOperation } from './approvalStore'
import { getProject, type ProjectConfig } from './projects'
import type { Env } from './types'

const APPROVAL_TTL_MS = 30 * 60 * 1000
const ROLLBACK_REASON = 'production_rollback'

const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' }, operation_id: { type: 'string' }, status: { type: 'string' },
    project_id: { type: 'string' }, repository: { type: 'object' }, branch: { type: 'string' },
    approval_required: { type: 'boolean' }, result: { type: 'object' }, error: { type: 'object' },
  },
  required: ['ok', 'operation_id', 'status'],
} as const

const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const

export const rollbackMcpTools = [{
  name: 'rollback_request',
  title: 'Request an exact production rollback rehearsal',
  description: 'Create a high-risk approval pinned to the current main SHA, exact Worker, exact Cloudflare version ID, exact target commit SHA, smoke expectation, and incident note. This request does not switch production traffic.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      worker: { type: 'string', enum: ['best-code-ide', 'best-code-ide-appl'] },
      target_version_id: { type: 'string' },
      target_commit_sha: { type: 'string' },
      incident_note: { type: 'string', minLength: 10, maxLength: 1000 },
      smoke_expectation: { type: 'string', minLength: 5, maxLength: 500 },
    },
    required: ['project_id', 'worker', 'target_version_id', 'target_commit_sha', 'incident_note', 'smoke_expectation'],
  },
  outputSchema,
  annotations: destructiveAnnotations,
}] as const

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

export interface RollbackToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: ToolEnvelope
  isError?: boolean
}

function finish(envelope: ToolEnvelope): RollbackToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }], structuredContent: envelope, ...(envelope.ok ? {} : { isError: true }) }
}

function required(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function repo(project: ProjectConfig) {
  return { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` }
}

export async function executeRollbackMcpTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
): Promise<RollbackToolResult> {
  const callId = crypto.randomUUID()
  try {
    if (name !== 'rollback_request') throw new Error(`Unknown rollback tool: ${name}`)
    const project = getProject(env, required(args, 'project_id'))
    const worker = required(args, 'worker')
    if (worker !== 'best-code-ide' && worker !== 'best-code-ide-appl') throw new Error('worker is not permitted')
    const targetVersionId = required(args, 'target_version_id')
    const targetCommitSha = required(args, 'target_commit_sha').toLowerCase()
    const incidentNote = required(args, 'incident_note')
    const smokeExpectation = required(args, 'smoke_expectation')
    if (!/^[0-9a-f]{40}$/.test(targetCommitSha)) throw new Error('target_commit_sha must be a full 40-character SHA')
    if (!/^[0-9a-f-]{20,64}$/i.test(targetVersionId)) throw new Error('target_version_id format is invalid')
    if (incidentNote.length < 10) throw new Error('incident_note is too short')

    const current = await gh.getBranch(token, project.owner, project.repo, project.defaultBranch)
    if (!current) throw new Error(`Default branch not found: ${project.defaultBranch}`)
    if (targetCommitSha === current.sha.toLowerCase()) throw new Error('Rollback target must differ from current main SHA')

    const now = new Date()
    const operation: ApprovalOperation = {
      operation_id: crypto.randomUUID(),
      project_id: project.id,
      repository: repo(project),
      branch: project.defaultBranch,
      title: `Rollback rehearsal ${worker}`,
      summary: `Exact rollback rehearsal request for ${worker}. Incident: ${incidentNote}. Smoke: ${smokeExpectation}.`,
      status: 'pending_approval',
      approval_required: true,
      risk: 'high',
      risk_reasons: [
        ROLLBACK_REASON,
        `rollback_worker:${worker}`,
        `rollback_target_version:${targetVersionId}`,
        `rollback_target_sha:${targetCommitSha}`,
        `rollback_current_main:${current.sha}`,
        'rollback_requires_restore',
        'rollback_requires_smoke_evidence',
      ],
      changes: [],
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
      base_context_sha: current.sha,
    }
    const stored = await createApproval(env, operation)
    return finish({
      ok: true,
      operation_id: stored.operation_id,
      status: stored.status,
      project_id: project.id,
      repository: repo(project),
      branch: project.defaultBranch,
      approval_required: true,
      result: {
        worker,
        current_main_sha: current.sha,
        target_version_id: targetVersionId,
        target_commit_sha: targetCommitSha,
        incident_note: incidentNote,
        smoke_expectation: smokeExpectation,
        risk: stored.risk,
        risk_reasons: stored.risk_reasons,
        expires_at: stored.expires_at,
        execution_started: false,
        next_action: 'Review and approve the exact rollback request in BestCode. Approval alone does not switch production traffic.',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return finish({
      ok: false,
      operation_id: callId,
      status: 'failed',
      error: { code: 'ROLLBACK_REQUEST_FAILED', message, retryable: false, action_required: 'Verify exact plan artifact values and create a new rollback request.' },
    })
  }
}
