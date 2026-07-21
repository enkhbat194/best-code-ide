import { createMission, getMission, listMissions, updateMission } from './missionStore'
import { assertWriterLeaseAvailable, type MissionLifecycle, type MissionRecord } from './missionSchema'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(value.trim())) throw new Error(`${field} must be a UUID-style identifier`)
  return value.trim()
}

function requireString(value: unknown, field: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim().slice(0, max)
}

function initialMission(body: Record<string, unknown>): MissionRecord {
  const now = new Date().toISOString()
  const missionId = requireId(body.mission_id, 'mission_id')
  const projectId = requireString(body.project_id, 'project_id', 64)
  const title = requireString(body.title, 'title', 300)
  return {
    mission_id: missionId,
    project_id: projectId,
    title,
    lifecycle: 'captured',
    goals: [],
    acceptance_criteria: [],
    decisions: [],
    tasks: [],
    operations: [],
    writer_lease: null,
    context_version: 1,
    context_hash: '',
    created_at: now,
    updated_at: now,
  }
}

export async function handleMissionApi(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/missions')) return null
  try {
    if (url.pathname === '/api/missions' && req.method === 'POST') {
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Mission body is required', 400)
      return jsonResponse(await createMission(env, initialMission(body as Record<string, unknown>)), 201)
    }

    if (url.pathname === '/api/missions' && req.method === 'GET') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '30'), 1), 100)
      const items = await listMissions(env, limit)
      return jsonResponse({ items, count: items.length })
    }

    const match = url.pathname.match(/^\/api\/missions\/([a-f0-9-]{16,64})(?:\/(transition|lease))?$/i)
    if (!match) return jsonError('Mission route not found', 404)
    const missionId = match[1]
    const action = match[2]

    if (!action && req.method === 'GET') return jsonResponse(await getMission(env, missionId))

    if (action === 'transition' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { expected_context_version?: number; lifecycle?: MissionLifecycle } | null
      if (!body || !Number.isInteger(body.expected_context_version) || typeof body.lifecycle !== 'string') {
        return jsonError('expected_context_version and lifecycle are required', 400)
      }
      return jsonResponse(await updateMission(env, missionId, body.expected_context_version!, (current) => ({ ...current, lifecycle: body.lifecycle! })))
    }

    if (action === 'lease' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as {
        expected_context_version?: number
        command?: 'acquire' | 'heartbeat' | 'release'
        holder_id?: string
        lease_id?: string
        ttl_seconds?: number
      } | null
      if (!body || !Number.isInteger(body.expected_context_version) || !body.command) return jsonError('Lease command and expected_context_version are required', 400)
      const holderId = requireString(body.holder_id, 'holder_id', 120)
      return jsonResponse(await updateMission(env, missionId, body.expected_context_version!, (current) => {
        const now = new Date()
        if (body.command === 'release') {
          if (!current.writer_lease || current.writer_lease.holder_id !== holderId) throw new Error('Only the active lease holder may release the lease')
          return { ...current, writer_lease: null }
        }
        assertWriterLeaseAvailable(current.writer_lease, holderId, now)
        const ttlSeconds = Math.min(Math.max(Number(body.ttl_seconds ?? 60), 15), 300)
        const leaseId = current.writer_lease?.holder_id === holderId
          ? current.writer_lease.lease_id
          : requireId(body.lease_id, 'lease_id')
        return {
          ...current,
          writer_lease: {
            lease_id: leaseId,
            holder_id: holderId,
            acquired_at: current.writer_lease?.holder_id === holderId ? current.writer_lease.acquired_at : now.toISOString(),
            heartbeat_at: now.toISOString(),
            expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
            context_version: current.context_version + 1,
          },
        }
      }))
    }

    return jsonError('Method not allowed', 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /not found/i.test(message) ? 404 : /mismatch|held by|transition|Only the active/i.test(message) ? 409 : 400
    return jsonError(message, status)
  }
}