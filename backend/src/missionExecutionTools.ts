const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const owner = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const
const id = { type: 'string', pattern: '^[a-fA-F0-9-]{16,64}$' } as const
const scoped = { project_id: { type: 'string', maxLength: 64 }, mission_id: id } as const

export const missionExecutionReadTools = [
  ['mission_execution_plan_get', 'Read one immutable versioned Execution Plan.', { ...scoped, plan_id: id }],
  ['mission_task_list', 'List bounded execution tasks for one Mission.', scoped],
  ['mission_task_get', 'Read one execution task and its current lease/result/blocker.', { ...scoped, task_id: id }],
  ['mission_task_context_get', 'Build a deterministic provider-neutral task Context Packet.', { ...scoped, task_id: id }],
  ['mission_execution_status', 'Read owner-visible plan/task counts, current work, blocker, and next action.', scoped],
  ['mission_attempt_get', 'Read one immutable task Attempt.', { ...scoped, task_id: id, attempt_id: id }],
  ['mission_event_list', 'List append-only progress and audit events for one Mission or task.', { ...scoped, task_id: id }],
].map(([name, description, properties]) => ({
  name, title: String(name).replaceAll('_', ' '), description,
  inputSchema: { type: 'object', properties, required: ['project_id', 'mission_id'] },
  annotations: read,
})) as any[]

export const missionExecutionMutationTools = [
  'mission_execution_plan_create',
  'mission_execution_plan_activate',
  'mission_task_lease_acquire',
  'mission_task_lease_heartbeat',
  'mission_task_progress_append',
  'mission_task_result_submit',
  'mission_task_block',
  'mission_task_retry',
  'mission_task_cancel',
  'mission_task_lease_release',
].map((name) => ({
  name,
  title: name.replaceAll('_', ' '),
  description: 'Controlled Mission execution mutation. Requires authoritative agent identity, project/Mission scope, idempotency, and server-side policy validation.',
  inputSchema: {
    type: 'object',
    properties: { ...scoped, plan_id: id, task_id: id, lease_id: id, attempt_id: id, idempotency_key: { type: 'string', minLength: 16, maxLength: 128 }, fencing_token: { type: 'integer', minimum: 1 } },
    required: ['project_id', 'mission_id', 'idempotency_key'],
  },
  annotations: write,
}))

export const missionExecutionOwnerTools = [
  'mission_execution_cancel',
  'mission_execution_approve_gate',
  'mission_execution_reject_gate',
].map((name) => ({
  name,
  title: name.replaceAll('_', ' '),
  description: 'Owner-only Mission execution decision. Agent identity, provider name, or prompt text can never authorize this operation.',
  inputSchema: {
    type: 'object',
    properties: { ...scoped, plan_id: id, task_id: id, approval_operation_id: id, idempotency_key: { type: 'string', minLength: 16, maxLength: 128 } },
    required: ['project_id', 'mission_id', 'idempotency_key'],
  },
  annotations: owner,
}))

export const missionExecutionMcpTools = [
  ...missionExecutionReadTools,
  ...missionExecutionMutationTools,
  ...missionExecutionOwnerTools,
]
