import { createMission, getMission, listMissions, updateMission } from './missionStore'
import { assertWriterLeaseAvailable, type MissionLifecycle, type MissionRecord } from './missionSchema'
import type { Env } from './types'

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const idSchema = { type: 'string', pattern: '^[a-fA-F0-9-]{16,64}$' } as const
const outputSchema = { type: 'object', properties: { ok: { type: 'boolean' }, operation_id: { type: 'string' }, status: { type: 'string' }, result: { type: 'object' }, error: { type: 'object' } }, required: ['ok', 'operation_id', 'status'] } as const

export const missionMcpTools = [
  { name: 'mission_create', title: 'Create Mission', description: 'Create durable Mission metadata in captured state. This does not execute repository or production actions.', inputSchema: { type: 'object', properties: { mission_id: idSchema, project_id: { type: 'string', maxLength: 64 }, title: { type: 'string', maxLength: 300 } }, required: ['mission_id', 'project_id', 'title'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_get', title: 'Get Mission', description: 'Read one Mission including lifecycle, context version/hash, graph, operations, and writer lease.', inputSchema: { type: 'object', properties: { mission_id: idSchema }, required: ['mission_id'] }, outputSchema, annotations: readAnnotations },
  { name: 'mission_list', title: 'List Missions', description: 'List bounded durable Missions ordered by latest update.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } } }, outputSchema, annotations: readAnnotations },
  { name: 'mission_transition', title: 'Transition Mission', description: 'Move a Mission through its locked lifecycle with optimistic context-version concurrency.', inputSchema: { type: 'object', properties: { mission_id: idSchema, expected_context_version: { type: 'integer', minimum: 1 }, lifecycle: { type: 'string' } }, required: ['mission_id', 'expected_context_version', 'lifecycle'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_lease', title: 'Manage Mission lease', description: 'Acquire, heartbeat, or release the one-active-writer Mission lease with bounded TTL.', inputSchema: { type: 'object', properties: { mission_id: idSchema, expected_context_version: { type: 'integer', minimum: 1 }, command: { type: 'string', enum: ['acquire', 'heartbeat', 'release'] }, holder_id: { type: 'string', maxLength: 120 }, lease_id: idSchema, ttl_seconds: { type: 'integer', minimum: 15, maximum: 300 } }, required: ['mission_id', 'expected_context_version', 'command', 'holder_id'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_context_packet', title: 'Build Mission context packet', description: 'Return a bounded provider-neutral Mission packet with goals, criteria, open decisions, active tasks, evidence IDs, lifecycle, version, and hash.', inputSchema: { type: 'object', properties: { mission_id: idSchema }, required: ['mission_id'] }, outputSchema, annotations: readAnnotations },
] as const

function envelope(ok: boolean, status: string, result?: Record<string, unknown>, message?: string) {
  const value = { ok, operation_id: crypto.randomUUID(), status, ...(result ? { result } : {}), ...(message ? { error: { code: 'MISSION_TOOL_ERROR', message, retryable: false, action_required: 'Refresh Mission state and retry with current context_version.' } } : {}) }
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value, ...(!ok ? { isError: true } : {}) }
}
function required(value: unknown, name: string, max = 300): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`); return value.trim().slice(0, max) }
function identifier(value: unknown, name: string): string { const parsed = required(value, name, 64); if (!/^[a-f0-9-]{16,64}$/i.test(parsed)) throw new Error(`${name} must be a UUID-style identifier`); return parsed }
function contextVersion(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 1) throw new Error('expected_context_version must be a positive integer'); return Number(value) }

export async function executeMissionMcpTool(name: string, args: Record<string, unknown>, _token: string, env: Env) {
  try {
    if (name === 'mission_create') {
      const timestamp = new Date().toISOString()
      const mission: MissionRecord = { mission_id: identifier(args.mission_id, 'mission_id'), project_id: required(args.project_id, 'project_id', 64), title: required(args.title, 'title'), lifecycle: 'captured', goals: [], acceptance_criteria: [], decisions: [], tasks: [], operations: [], writer_lease: null, context_version: 1, context_hash: '', created_at: timestamp, updated_at: timestamp }
      return envelope(true, 'created', { mission: await createMission(env, mission) })
    }
    if (name === 'mission_get') return envelope(true, 'completed', { mission: await getMission(env, identifier(args.mission_id, 'mission_id')) })
    if (name === 'mission_list') { const items = await listMissions(env, Math.min(Math.max(Number(args.limit ?? 30), 1), 100)); return envelope(true, 'completed', { items, count: items.length }) }
    if (name === 'mission_transition') {
      const mission = await updateMission(env, identifier(args.mission_id, 'mission_id'), contextVersion(args.expected_context_version), (current) => ({ ...current, lifecycle: required(args.lifecycle, 'lifecycle', 30) as MissionLifecycle }))
      return envelope(true, 'completed', { mission })
    }
    if (name === 'mission_lease') {
      const command = required(args.command, 'command', 20)
      const holderId = required(args.holder_id, 'holder_id', 120)
      const mission = await updateMission(env, identifier(args.mission_id, 'mission_id'), contextVersion(args.expected_context_version), (current) => {
        const now = new Date()
        if (command === 'release') {
          if (!current.writer_lease || current.writer_lease.holder_id !== holderId) throw new Error('Only the active lease holder may release the lease')
          return { ...current, writer_lease: null }
        }
        assertWriterLeaseAvailable(current.writer_lease, holderId, now)
        const ttl = Math.min(Math.max(Number(args.ttl_seconds ?? 60), 15), 300)
        return { ...current, writer_lease: { lease_id: current.writer_lease?.holder_id === holderId ? current.writer_lease.lease_id : identifier(args.lease_id, 'lease_id'), holder_id: holderId, acquired_at: current.writer_lease?.holder_id === holderId ? current.writer_lease.acquired_at : now.toISOString(), heartbeat_at: now.toISOString(), expires_at: new Date(now.getTime() + ttl * 1000).toISOString(), context_version: current.context_version + 1 } }
      })
      return envelope(true, 'completed', { mission })
    }
    if (name === 'mission_context_packet') {
      const mission = await getMission(env, identifier(args.mission_id, 'mission_id'))
      return envelope(true, 'completed', { packet: { schema: 'mission-context-packet-v1', mission_id: mission.mission_id, project_id: mission.project_id, title: mission.title, lifecycle: mission.lifecycle, context_version: mission.context_version, context_hash: mission.context_hash, goals: mission.goals, acceptance_criteria: mission.acceptance_criteria, open_decisions: mission.decisions.filter((item) => item.status === 'open'), active_tasks: mission.tasks.filter((item) => ['ready', 'running', 'waiting', 'blocked'].includes(item.status)), evidence_ids: [...new Set(mission.acceptance_criteria.flatMap((item) => item.evidence_ids))], writer_lease: mission.writer_lease } })
    }
    throw new Error(`Unknown Mission tool: ${name}`)
  } catch (error) { return envelope(false, 'failed', undefined, error instanceof Error ? error.message : String(error)) }
}
