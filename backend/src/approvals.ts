import { cancelApproval, decideApproval, getApproval, listApprovals } from './approvalClient'
import { jsonError, jsonResponse } from './utils'
import type { Env } from './types'

export async function handleApprovals(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/approvals' && req.method === 'GET') {
    try {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 100)
      const result = await listApprovals(env, {
        status: url.searchParams.get('status') ?? undefined,
        projectId: url.searchParams.get('project_id') ?? undefined,
        limit,
      })
      return jsonResponse(result)
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 502)
    }
  }

  const match = url.pathname.match(/^\/api\/approvals\/([a-f0-9-]{16,64})(?:\/(decision|cancel))?$/i)
  if (!match) return null
  const operationId = match[1]
  const action = match[2]

  try {
    if (!action && req.method === 'GET') return jsonResponse(await getApproval(env, operationId))

    if (action === 'decision' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { decision?: string; actor?: string } | null
      if (body?.decision !== 'approved' && body?.decision !== 'rejected') {
        return jsonError('decision must be approved or rejected')
      }
      return jsonResponse(await decideApproval(env, operationId, body.decision, body.actor?.trim() || 'bestcode-user'))
    }

    if (action === 'cancel' && req.method === 'POST') {
      return jsonResponse(await cancelApproval(env, operationId))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /not found/i.test(message) ? 404 : /cannot be/i.test(message) ? 409 : 502
    return jsonError(message, status)
  }

  return jsonError('Method not allowed', 405)
}
