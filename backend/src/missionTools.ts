import { createMission, getMission, listMissions, updateMission } from './missionStore'
import {
  assertWriterLeaseAvailable,
  type AcceptanceCriterion,
  type MissionDecision,
  type MissionGoal,
  type MissionLifecycle,
  type MissionOperation,
  type MissionRecord,
  type MissionTask,
} from './missionSchema'
import type { Env } from './types'

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const idSchema = { type: 'string', pattern: '^[a-fA-F0-9-]{16,64}$' } as const
const keySchema = { type: 'string', pattern: '^[A-Za-z0-9._:-]{16,128}$' } as const
const outputSchema = { type: 'object', properties: { ok: { type: 'boolean' }, operation_id: { type: 'string' }, status: { type: 'string' }, result: { type: 'object' }, error: { type: 'object' } }, required: ['ok', 'operation_id', 'status'] } as const
const mutationKinds = ['add_goal', 'add_criterion', 'record_decision', 'resolve_decision', 'add_task', 'update_task', 'record_operation', 'update_operation'] as const

type MutationKind = typeof mutationKinds[number]

export const missionMcpTools = [
  { name: 'mission_create', title: 'Create Mission', description: 'Create durable Mission metadata in captured state. This does not execute repository or production actions.', inputSchema: { type: 'object', properties: { mission_id: idSchema, project_id: { type: 'string', maxLength: 64 }, title: { type: 'string', maxLength: 300 } }, required: ['mission_id', 'project_id', 'title'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_get', title: 'Get Mission', description: 'Read one Mission including lifecycle, context version/hash, graph, operations, and writer lease.', inputSchema: { type: 'object', properties: { mission_id: idSchema }, required: ['mission_id'] }, outputSchema, annotations: readAnnotations },
  { name: 'mission_list', title: 'List Missions', description: 'List bounded durable Missions ordered by latest update.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } } }, outputSchema, annotations: readAnnotations },
  { name: 'mission_transition', title: 'Transition Mission', description: 'Move a Mission through its locked lifecycle with optimistic context-version concurrency.', inputSchema: { type: 'object', properties: { mission_id: idSchema, expected_context_version: { type: 'integer', minimum: 1 }, lifecycle: { type: 'string' } }, required: ['mission_id', 'expected_context_version', 'lifecycle'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_lease', title: 'Manage Mission lease', description: 'Acquire, heartbeat, or release the one-active-writer Mission lease with bounded TTL.', inputSchema: { type: 'object', properties: { mission_id: idSchema, expected_context_version: { type: 'integer', minimum: 1 }, command: { type: 'string', enum: ['acquire', 'heartbeat', 'release'] }, holder_id: { type: 'string', maxLength: 120 }, lease_id: idSchema, ttl_seconds: { type: 'integer', minimum: 15, maximum: 300 } }, required: ['mission_id', 'expected_context_version', 'command', 'holder_id'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_mutate', title: 'Mutate Mission object', description: 'Idempotently add or update one Goal, criterion, Decision, Task, or Operation using current context version and active writer lease.', inputSchema: { type: 'object', properties: { mission_id: idSchema, expected_context_version: { type: 'integer', minimum: 1 }, holder_id: { type: 'string', maxLength: 120 }, lease_id: idSchema, idempotency_key: keySchema, operation_id: idSchema, mutation: { type: 'string', enum: mutationKinds }, entity: { type: 'object', additionalProperties: true } }, required: ['mission_id', 'expected_context_version', 'holder_id', 'lease_id', 'idempotency_key', 'operation_id', 'mutation', 'entity'] }, outputSchema, annotations: writeAnnotations },
  { name: 'mission_context_packet', title: 'Build Mission context packet', description: 'Return a bounded provider-neutral Mission packet with goals, criteria, open decisions, active tasks, evidence IDs, lifecycle, version, and hash.', inputSchema: { type: 'object', properties: { mission_id: idSchema }, required: ['mission_id'] }, outputSchema, annotations: readAnnotations },
] as const

function envelope(ok: boolean, status: string, result?: Record<string, unknown>, message?: string) {
  const value = { ok, operation_id: crypto.randomUUID(), status, ...(result ? { result } : {}), ...(message ? { error: { code: 'MISSION_TOOL_ERROR', message, retryable: false, action_required: 'Refresh Mission state and retry with current context_version.' } } : {}) }
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value, ...(!ok ? { isError: true } : {}) }
}
function required(value: unknown, name: string, max = 300): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`); return value.trim().slice(0, max) }
function identifier(value: unknown, name: string): string { const parsed = required(value, name, 64); if (!/^[a-f0-9-]{16,64}$/i.test(parsed)) throw new Error(`${name} must be a UUID-style identifier`); return parsed }
function idempotencyKey(value: unknown): string { const parsed = required(value, 'idempotency_key', 128); if (!/^[A-Za-z0-9._:-]{16,128}$/.test(parsed)) throw new Error('idempotency_key must be 16-128 URL-safe characters'); return parsed }
function contextVersion(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 1) throw new Error('expected_context_version must be a positive integer'); return Number(value) }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('entity must be an object'); return value as Record<string, unknown> }
function stringList(value: unknown, maxItems = 50, maxChars = 500): string[] { if (!Array.isArray(value)) return []; return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, maxChars)).filter(Boolean))].slice(0, maxItems) }
function nowIso(): string { return new Date().toISOString() }

function requireActiveLease(mission: MissionRecord, holderId: string, leaseId: string): void {
  const lease = mission.writer_lease
  if (!lease || lease.holder_id !== holderId || lease.lease_id !== leaseId || Date.parse(lease.expires_at) <= Date.now()) {
    throw new Error('Mission mutation requires the current active writer lease')
  }
}

function applyMutation(current: MissionRecord, mutation: MutationKind, entity: Record<string, unknown>): MissionRecord {
  const now = nowIso()
  if (mutation === 'add_goal') {
    const item: MissionGoal = { goal_id: identifier(entity.goal_id, 'goal_id'), title: required(entity.title, 'title'), outcome: required(entity.outcome, 'outcome', 1000), created_at: now }
    if (current.goals.some((value) => value.goal_id === item.goal_id)) throw new Error('Goal already exists')
    return { ...current, goals: [...current.goals, item] }
  }
  if (mutation === 'add_criterion') {
    const item: AcceptanceCriterion = { criterion_id: identifier(entity.criterion_id, 'criterion_id'), statement: required(entity.statement, 'statement', 1000), status: 'pending', evidence_ids: stringList(entity.evidence_ids) }
    if (current.acceptance_criteria.some((value) => value.criterion_id === item.criterion_id)) throw new Error('Acceptance criterion already exists')
    return { ...current, acceptance_criteria: [...current.acceptance_criteria, item] }
  }
  if (mutation === 'record_decision') {
    const item: MissionDecision = { decision_id: identifier(entity.decision_id, 'decision_id'), title: required(entity.title, 'title'), status: 'open', rationale: required(entity.rationale, 'rationale', 2000), decided_at: null }
    if (current.decisions.some((value) => value.decision_id === item.decision_id)) throw new Error('Decision already exists')
    return { ...current, decisions: [...current.decisions, item] }
  }
  if (mutation === 'resolve_decision') {
    const id = identifier(entity.decision_id, 'decision_id')
    const status = required(entity.status, 'status', 20) as MissionDecision['status']
    if (!['accepted', 'rejected', 'superseded'].includes(status)) throw new Error('Decision resolution status is invalid')
    if (!current.decisions.some((value) => value.decision_id === id)) throw new Error('Decision not found')
    return { ...current, decisions: current.decisions.map((value) => value.decision_id === id ? { ...value, status, rationale: required(entity.rationale ?? value.rationale, 'rationale', 2000), decided_at: now } : value) }
  }
  if (mutation === 'add_task') {
    const item: MissionTask = { task_id: identifier(entity.task_id, 'task_id'), title: required(entity.title, 'title'), priority: required(entity.priority ?? 'normal', 'priority', 20) as MissionTask['priority'], status: 'pending', dependency_ids: stringList(entity.dependency_ids), operation_ids: [], assigned_agent_id: typeof entity.assigned_agent_id === 'string' ? entity.assigned_agent_id.trim().slice(0, 120) || null : null, created_at: now, updated_at: now }
    if (!['critical', 'high', 'normal', 'low', 'background'].includes(item.priority)) throw new Error('Task priority is invalid')
    if (current.tasks.some((value) => value.task_id === item.task_id)) throw new Error('Task already exists')
    return { ...current, tasks: [...current.tasks, item] }
  }
  if (mutation === 'update_task') {
    const id = identifier(entity.task_id, 'task_id')
    if (!current.tasks.some((value) => value.task_id === id)) throw new Error('Task not found')
    return { ...current, tasks: current.tasks.map((value) => value.task_id === id ? { ...value, ...(typeof entity.title === 'string' ? { title: required(entity.title, 'title') } : {}), ...(typeof entity.status === 'string' ? { status: required(entity.status, 'status', 20) as MissionTask['status'] } : {}), ...(typeof entity.priority === 'string' ? { priority: required(entity.priority, 'priority', 20) as MissionTask['priority'] } : {}), ...(Array.isArray(entity.dependency_ids) ? { dependency_ids: stringList(entity.dependency_ids) } : {}), ...(entity.assigned_agent_id !== undefined ? { assigned_agent_id: typeof entity.assigned_agent_id === 'string' ? entity.assigned_agent_id.trim().slice(0, 120) || null : null } : {}), updated_at: now } : value) }
  }
  if (mutation === 'record_operation') {
    const item: MissionOperation = { operation_id: identifier(entity.operation_id, 'entity.operation_id'), kind: required(entity.kind, 'kind', 120), status: 'planned', task_id: typeof entity.task_id === 'string' ? identifier(entity.task_id, 'task_id') : null, idempotency_key: idempotencyKey(entity.idempotency_key), created_at: now, updated_at: now }
    if (current.operations.some((value) => value.operation_id === item.operation_id || value.idempotency_key === item.idempotency_key)) throw new Error('Operation already exists')
    return { ...current, operations: [...current.operations, item], tasks: item.task_id ? current.tasks.map((task) => task.task_id === item.task_id ? { ...task, operation_ids: [...new Set([...task.operation_ids, item.operation_id])], updated_at: now } : task) : current.tasks }
  }
  const id = identifier(entity.operation_id, 'entity.operation_id')
  const status = required(entity.status, 'status', 30) as MissionOperation['status']
  if (!current.operations.some((value) => value.operation_id === id)) throw new Error('Operation not found')
  return { ...current, operations: current.operations.map((value) => value.operation_id === id ? { ...value, status, updated_at: now } : value) }
}

export async function executeMissionMcpTool(name: string, args: Record<string, unknown>, _token: string, env: Env) {
  try {
    if (name === 'mission_create') {
      const timestamp = nowIso()
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
    if (name === 'mission_mutate') {
      const missionId = identifier(args.mission_id, 'mission_id')
      const expected = contextVersion(args.expected_context_version)
      const holderId = required(args.holder_id, 'holder_id', 120)
      const leaseId = identifier(args.lease_id, 'lease_id')
      const key = idempotencyKey(args.idempotency_key)
      const auditOperationId = identifier(args.operation_id, 'operation_id')
      const mutation = required(args.mutation, 'mutation', 40) as MutationKind
      if (!mutationKinds.includes(mutation)) throw new Error('Unknown Mission mutation')
      const current = await getMission(env, missionId)
      const replay = current.operations.find((item) => item.idempotency_key === key && item.kind === `mission_mutation:${mutation}`)
      if (replay) return envelope(true, 'replayed', { mission: current, mutation_operation: replay })
      const mission = await updateMission(env, missionId, expected, (value) => {
        requireActiveLease(value, holderId, leaseId)
        const changed = applyMutation(value, mutation, object(args.entity))
        const timestamp = nowIso()
        const mutationOperation: MissionOperation = { operation_id: auditOperationId, kind: `mission_mutation:${mutation}`, status: 'completed', task_id: null, idempotency_key: key, created_at: timestamp, updated_at: timestamp }
        if (changed.operations.some((item) => item.operation_id === auditOperationId || item.idempotency_key === key)) throw new Error('Mutation operation already exists')
        return { ...changed, operations: [...changed.operations, mutationOperation] }
      })
      return envelope(true, 'completed', { mission })
    }
    if (name === 'mission_context_packet') {
      const mission = await getMission(env, identifier(args.mission_id, 'mission_id'))
      return envelope(true, 'completed', { packet: { schema: 'mission-context-packet-v1', mission_id: mission.mission_id, project_id: mission.project_id, title: mission.title, lifecycle: mission.lifecycle, context_version: mission.context_version, context_hash: mission.context_hash, goals: mission.goals, acceptance_criteria: mission.acceptance_criteria, open_decisions: mission.decisions.filter((item) => item.status === 'open'), active_tasks: mission.tasks.filter((item) => ['pending', 'ready', 'running', 'waiting', 'blocked'].includes(item.status)), evidence_ids: [...new Set(mission.acceptance_criteria.flatMap((item) => item.evidence_ids))], writer_lease: mission.writer_lease } })
    }
    throw new Error(`Unknown Mission tool: ${name}`)
  } catch (error) { return envelope(false, 'failed', undefined, error instanceof Error ? error.message : String(error)) }
}
