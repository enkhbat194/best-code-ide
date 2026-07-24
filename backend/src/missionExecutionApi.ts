import { buildExecutionContextPacket, executionStatus } from './missionExecutionService'
import { commandMissionExecution, getMissionExecution } from './missionExecutionStore'
import { getMission } from './missionStore'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

export async function handleMissionExecutionApi(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/mission-executions/')) return null
  try {
    const match = url.pathname.match(/^\/api\/mission-executions\/([a-f0-9-]{16,64})(?:\/(status|context|command))?$/i)
    if (!match) return jsonError('Mission execution route not found', 404)
    const missionId = match[1]
    const action = match[2]
    const mission = await getMission(env, missionId)

    if (req.method === 'GET' && !action) return jsonResponse(await getMissionExecution(env, missionId))
    if (req.method === 'GET' && action === 'status') return jsonResponse(executionStatus(await getMissionExecution(env, missionId)))
    if (req.method === 'GET' && action === 'context') {
      const taskId = url.searchParams.get('task_id')
      if (!taskId) return jsonError('task_id is required', 400)
      return jsonResponse(await buildExecutionContextPacket(await getMissionExecution(env, missionId), taskId))
    }
    if (req.method === 'POST' && action === 'command') {
      const body = await req.json().catch(() => null) as Record<string, any> | null
      if (!body || typeof body.command !== 'string') return jsonError('Execution command body is required', 400)
      if (body.project_id !== mission.project_id) return jsonError('Cross-project Mission execution access denied', 409)
      const actorId = req.headers.get('X-BestCode-Agent-Id')?.trim().slice(0, 160) || 'owner-api'
      return jsonResponse(await commandMissionExecution(env, {
        command: body.command,
        project_id: mission.project_id,
        mission_id: missionId,
        actor_id: actorId,
        idempotency_key: String(req.headers.get('Idempotency-Key') ?? body.idempotency_key ?? ''),
        ...(Number.isInteger(body.expected_version) ? { expected_version: Number(body.expected_version) } : {}),
        now: new Date().toISOString(),
        args: body,
      }))
    }
    return jsonError('Method not allowed', 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, /not found/i.test(message) ? 404 : /mismatch|denied|cancelled|approval|lease/i.test(message) ? 409 : 400)
  }
}
