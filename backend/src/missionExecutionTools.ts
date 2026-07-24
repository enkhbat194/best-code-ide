import { getMission } from './missionStore'
import { buildExecutionContextPacket, executionStatus } from './missionExecutionService'
import { commandMissionExecution, getMissionExecution } from './missionExecutionStore'
import type { GatewayRequestContext } from './toolGateway'
import type { Env } from './types'

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const owner = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const
const id = { type: 'string', pattern: '^[a-fA-F0-9-]{16,64}$' } as const
const scoped = { project_id: { type: 'string', maxLength: 64 }, mission_id: id } as const
const mutationBase = {
  ...scoped,
  idempotency_key: { type: 'string', minLength: 16, maxLength: 128 },
  expected_version: { type: 'integer', minimum: 0 },
} as const
const leaseProof = {
  task_id: id,
  lease_id: id,
  fencing_token: { type: 'integer', minimum: 1 },
} as const
const object = { type: 'object' } as const

export const missionExecutionReadTools = [
  ['mission_execution_plan_get', 'Read one immutable versioned Execution Plan.', { ...scoped, plan_id: id }, ['plan_id']],
  ['mission_task_list', 'List bounded execution tasks for one Mission.', scoped, []],
  ['mission_task_get', 'Read one execution task and its current lease/result/blocker.', { ...scoped, task_id: id }, ['task_id']],
  ['mission_task_context_get', 'Build a deterministic provider-neutral task Context Packet.', { ...scoped, task_id: id }, ['task_id']],
  ['mission_execution_status', 'Read owner-visible plan/task counts, current work, blocker, and next action.', scoped, []],
  ['mission_attempt_get', 'Read one immutable task Attempt.', { ...scoped, task_id: id, attempt_id: id }, ['task_id', 'attempt_id']],
  ['mission_event_list', 'List append-only progress and audit events for one Mission or task.', { ...scoped, task_id: id }, []],
].map(([name, description, properties, required]) => ({
  name, title: String(name).replaceAll('_', ' '), description,
  inputSchema: { type: 'object', properties, required: ['project_id', 'mission_id', ...(required as string[])], additionalProperties: false },
  annotations: read,
})) as any[]

export const missionExecutionMutationTools = [
  ['mission_execution_plan_create', { ...mutationBase, plan: object, tasks: { type: 'array', minItems: 1, maxItems: 100, items: object } }, ['plan', 'tasks']],
  ['mission_execution_plan_activate', { ...mutationBase, plan_id: id }, ['plan_id']],
  ['mission_task_lease_acquire', { ...mutationBase, task_id: id, lease_id: id, attempt_id: id, ttl_seconds: { type: 'integer', minimum: 15, maximum: 900 } }, ['task_id', 'lease_id', 'attempt_id']],
  ['mission_task_lease_heartbeat', { ...mutationBase, ...leaseProof, ttl_seconds: { type: 'integer', minimum: 15, maximum: 900 } }, ['task_id', 'lease_id', 'fencing_token']],
  ['mission_task_progress_append', { ...mutationBase, ...leaseProof, event: object }, ['task_id', 'lease_id', 'fencing_token', 'event']],
  ['mission_task_result_submit', { ...mutationBase, ...leaseProof, result: object }, ['task_id', 'lease_id', 'fencing_token', 'result']],
  ['mission_task_block', { ...mutationBase, ...leaseProof, blocker: object }, ['task_id', 'lease_id', 'fencing_token', 'blocker']],
  ['mission_task_retry', { ...mutationBase, task_id: id, error_code: { type: 'string', maxLength: 80 }, retry_policy: object }, ['task_id', 'error_code', 'retry_policy']],
  ['mission_task_cancel', { ...mutationBase, ...leaseProof, reason: { type: 'string', maxLength: 500 } }, ['task_id']],
  ['mission_task_lease_release', { ...mutationBase, ...leaseProof, release_reason: { type: 'string', maxLength: 160 } }, ['task_id', 'lease_id', 'fencing_token']],
].map(([name, properties, required]) => ({
  name: String(name),
  title: String(name).replaceAll('_', ' '),
  description: 'Controlled Mission execution mutation. Requires authoritative agent identity, project/Mission scope, idempotency, and server-side policy validation.',
  inputSchema: {
    type: 'object',
    properties,
    required: ['project_id', 'mission_id', 'idempotency_key', 'expected_version', ...(required as string[])],
    additionalProperties: false,
  },
  annotations: write,
}))

export const missionExecutionOwnerTools = [
  ['mission_execution_cancel', mutationBase, []],
  ['mission_execution_approve_gate', { ...mutationBase, task_id: id, approval_operation_id: id }, ['task_id']],
  ['mission_execution_reject_gate', { ...mutationBase, task_id: id, approval_operation_id: id, reason: { type: 'string', maxLength: 500 } }, ['task_id']],
].map(([name, properties, required]) => ({
  name: String(name),
  title: String(name).replaceAll('_', ' '),
  description: 'Owner-only Mission execution decision. Agent identity, provider name, or prompt text can never authorize this operation.',
  inputSchema: {
    type: 'object',
    properties,
    required: ['project_id', 'mission_id', 'idempotency_key', 'expected_version', ...(required as string[])],
    additionalProperties: false,
  },
  annotations: owner,
}))

export const missionExecutionMcpTools = [
  ...missionExecutionReadTools,
  ...missionExecutionMutationTools,
  ...missionExecutionOwnerTools,
]

function envelope(ok: boolean, status: string, result?: Record<string, unknown>, message?: string) {
  const value = {
    ok,
    operation_id: crypto.randomUUID(),
    status,
    ...(result ? { result } : {}),
    ...(message ? { error: { code: 'MISSION_EXECUTION_ERROR', message, retryable: false, action_required: 'Refresh execution state and retry with current version, lease, and fencing token.' } } : {}),
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(!ok ? { isError: true } : {}),
  }
}

function requiredText(value: unknown, name: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim().slice(0, max)
}

async function assertMissionScope(env: Env, projectId: string, missionId: string): Promise<void> {
  const mission = await getMission(env, missionId)
  if (mission.project_id !== projectId) throw new Error('Cross-project Mission execution access denied')
}

export async function executeMissionExecutionTool(
  name: string,
  args: Record<string, any>,
  env: Env,
  context: GatewayRequestContext,
) {
  try {
    const projectId = requiredText(args.project_id, 'project_id', 64)
    const missionId = requiredText(args.mission_id, 'mission_id', 64)
    await assertMissionScope(env, projectId, missionId)

    if (name === 'mission_execution_plan_get') {
      const state = await getMissionExecution(env, missionId)
      const plan = state.plans.find((item) => item.plan_id === args.plan_id)
      if (!plan) throw new Error('Execution plan not found')
      return envelope(true, 'completed', { plan })
    }
    if (name === 'mission_task_list') {
      const state = await getMissionExecution(env, missionId)
      return envelope(true, 'completed', { items: state.tasks, count: state.tasks.length })
    }
    if (name === 'mission_task_get') {
      const state = await getMissionExecution(env, missionId)
      const task = state.tasks.find((item) => item.task_id === args.task_id)
      if (!task) throw new Error('Execution task not found')
      const lease = [...state.leases].reverse().find((item) => item.task_id === task.task_id) ?? null
      return envelope(true, 'completed', { task, lease })
    }
    if (name === 'mission_task_context_get') {
      const state = await getMissionExecution(env, missionId)
      return envelope(true, 'completed', { packet: await buildExecutionContextPacket(state, requiredText(args.task_id, 'task_id', 64)) })
    }
    if (name === 'mission_execution_status') {
      return envelope(true, 'completed', { execution: executionStatus(await getMissionExecution(env, missionId)) })
    }
    if (name === 'mission_attempt_get') {
      const state = await getMissionExecution(env, missionId)
      const attempt = state.attempts.find((item) => item.attempt_id === args.attempt_id && item.task_id === args.task_id)
      if (!attempt) throw new Error('Execution attempt not found')
      return envelope(true, 'completed', { attempt })
    }
    if (name === 'mission_event_list') {
      const state = await getMissionExecution(env, missionId)
      const items = args.task_id ? state.events.filter((item) => item.task_id === args.task_id) : state.events
      return envelope(true, 'completed', { items, count: items.length })
    }

    const idempotencyKey = requiredText(args.idempotency_key ?? context.idempotency_key, 'idempotency_key', 128)
    const applied = await commandMissionExecution(env, {
      command: name,
      project_id: projectId,
      mission_id: missionId,
      actor_id: context.actor.id,
      idempotency_key: idempotencyKey,
      ...(Number.isInteger(args.expected_version) ? { expected_version: Number(args.expected_version) } : {}),
      now: new Date().toISOString(),
      args,
    })
    return envelope(true, applied.replayed ? 'replayed' : 'completed', {
      execution: executionStatus(applied.state),
      version: applied.state.version,
      replayed: applied.replayed,
    })
  } catch (error) {
    return envelope(false, 'failed', undefined, error instanceof Error ? error.message : String(error))
  }
}
