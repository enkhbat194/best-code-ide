import { cancelApproval, decideApproval, getApproval, listApprovals } from './approvalClient'
import type { ApprovalOperation } from './approvalStore'
import { jsonError, jsonResponse } from './utils'
import type { Env } from './types'

function publicOperation(operation: ApprovalOperation) {
  return {
    operation_id: operation.operation_id,
    project_id: operation.project_id,
    repository: operation.repository,
    branch: operation.branch,
    title: operation.title,
    summary: operation.summary,
    status: operation.status,
    approval_required: operation.approval_required,
    risk: operation.risk,
    risk_reasons: operation.risk_reasons,
    changes: operation.changes.map((change) => ({
      action: change.action,
      path: change.path,
      base_sha: change.base_sha,
      diff: change.diff.slice(0, 100_000),
      diff_truncated: change.diff.length > 100_000,
    })),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
    expires_at: operation.expires_at,
    base_context_sha: operation.base_context_sha,
    decided_at: operation.decided_at,
    decision: operation.decision,
    decision_actor: operation.decision_actor,
    expired_at: operation.expired_at,
    superseded_at: operation.superseded_at,
    superseded_reason: operation.superseded_reason,
    commit_sha: operation.prepared_commit_sha,
    commit_url: operation.prepared_commit_url,
    completed_at: operation.completed_at,
  }
}

export async function handleApprovals(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/approvals' && req.method === 'GET') {
    try {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 100)
      const result = await listApprovals(env, {
        status: url.searchParams.get('status') ?? undefined,
        projectId: url.searchParams.get('project_id') ?? undefined,
        limit,
      })
      return jsonResponse({
        items: result.items.map(publicOperation),
        count: result.count,
        total: result.total,
      })
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 502)
    }
  }

  const match = url.pathname.match(/^\/api\/approvals\/([a-f0-9-]{16,64})(?:\/(decision|cancel))?$/i)
  if (!match) return null
  const operationId = match[1]
  const action = match[2]

  try {
    if (!action && req.method === 'GET') return jsonResponse(publicOperation(await getApproval(env, operationId)))

    if (action === 'decision' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as {
        decision?: string
        actor?: string
        idempotency_key?: string
      } | null
      if (body?.decision !== 'approved' && body?.decision !== 'rejected') {
        return jsonError('decision must be approved or rejected')
      }
      const operation = await decideApproval(
        env,
        operationId,
        body.decision,
        body.actor?.trim() || 'bestcode-user',
        body.idempotency_key,
      )
      return jsonResponse(publicOperation(operation))
    }

    if (action === 'cancel' && req.method === 'POST') {
      return jsonResponse(publicOperation(await cancelApproval(env, operationId)))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /not found/i.test(message) ? 404 : /cannot be/i.test(message) ? 409 : 502
    return jsonError(message, status)
  }

  return jsonError('Method not allowed', 405)
}
