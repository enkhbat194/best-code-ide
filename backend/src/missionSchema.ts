export type MissionLifecycle =
  | 'captured'
  | 'framing'
  | 'planned'
  | 'executing'
  | 'verifying'
  | 'decision'
  | 'completed'
  | 'packaged'
  | 'paused'
  | 'cancelled'
  | 'failed'

export type MissionTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type MissionTaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background'

export interface MissionGoal {
  goal_id: string
  title: string
  outcome: string
  created_at: string
}

export interface AcceptanceCriterion {
  criterion_id: string
  statement: string
  status: 'pending' | 'passed' | 'failed' | 'waived'
  evidence_ids: string[]
}

export interface MissionDecision {
  decision_id: string
  title: string
  status: 'open' | 'accepted' | 'rejected' | 'superseded'
  rationale: string
  decided_at: string | null
}

export interface MissionTask {
  task_id: string
  title: string
  priority: MissionTaskPriority
  status: MissionTaskStatus
  dependency_ids: string[]
  operation_ids: string[]
  assigned_agent_id: string | null
  created_at: string
  updated_at: string
}

export interface MissionOperation {
  operation_id: string
  kind: string
  status: 'planned' | 'pending_approval' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled' | 'superseded'
  task_id: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

export interface MissionWriterLease {
  lease_id: string
  holder_id: string
  acquired_at: string
  heartbeat_at: string
  expires_at: string
  context_version: number
}

export interface MissionRecord {
  mission_id: string
  project_id: string
  title: string
  lifecycle: MissionLifecycle
  goals: MissionGoal[]
  acceptance_criteria: AcceptanceCriterion[]
  decisions: MissionDecision[]
  tasks: MissionTask[]
  operations: MissionOperation[]
  writer_lease: MissionWriterLease | null
  context_version: number
  context_hash: string
  created_at: string
  updated_at: string
}

const TERMINAL_LIFECYCLES = new Set<MissionLifecycle>(['completed', 'packaged', 'cancelled', 'failed'])

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<MissionLifecycle, ReadonlySet<MissionLifecycle>> = {
  captured: new Set(['framing', 'cancelled']),
  framing: new Set(['planned', 'paused', 'cancelled', 'failed']),
  planned: new Set(['executing', 'paused', 'cancelled', 'failed']),
  executing: new Set(['verifying', 'decision', 'paused', 'cancelled', 'failed']),
  verifying: new Set(['decision', 'completed', 'executing', 'paused', 'failed']),
  decision: new Set(['planned', 'executing', 'completed', 'paused', 'cancelled', 'failed']),
  completed: new Set(['packaged']),
  packaged: new Set(),
  paused: new Set(['framing', 'planned', 'executing', 'verifying', 'decision', 'cancelled']),
  cancelled: new Set(),
  failed: new Set(['planned', 'cancelled']),
}

export function assertMissionLifecycleTransition(from: MissionLifecycle, to: MissionLifecycle): void {
  if (from === to) return
  if (!ALLOWED_LIFECYCLE_TRANSITIONS[from].has(to)) {
    throw new Error(`Mission lifecycle transition is not allowed: ${from} -> ${to}`)
  }
}

export function isTerminalMissionLifecycle(value: MissionLifecycle): boolean {
  return TERMINAL_LIFECYCLES.has(value)
}

export function assertValidMissionGraph(tasks: MissionTask[]): void {
  const byId = new Map<string, MissionTask>()
  for (const task of tasks) {
    if (byId.has(task.task_id)) throw new Error(`Mission task graph contains duplicate task_id: ${task.task_id}`)
    byId.set(task.task_id, task)
  }

  for (const task of tasks) {
    if (task.dependency_ids.includes(task.task_id)) throw new Error(`Mission task ${task.task_id} cannot depend on itself`)
    for (const dependencyId of task.dependency_ids) {
      if (!byId.has(dependencyId)) throw new Error(`Mission task ${task.task_id} depends on missing task ${dependencyId}`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) throw new Error(`Mission task graph contains a dependency cycle at ${taskId}`)
    if (visited.has(taskId)) return
    visiting.add(taskId)
    for (const dependencyId of byId.get(taskId)?.dependency_ids ?? []) visit(dependencyId)
    visiting.delete(taskId)
    visited.add(taskId)
  }
  for (const task of tasks) visit(task.task_id)
}

export function computeMissionContextHash(input: {
  mission_id: string
  project_id: string
  lifecycle: MissionLifecycle
  context_version: number
  goal_ids: string[]
  task_ids: string[]
  decision_ids: string[]
}): string {
  const canonical = JSON.stringify({
    mission_id: input.mission_id,
    project_id: input.project_id,
    lifecycle: input.lifecycle,
    context_version: input.context_version,
    goal_ids: [...input.goal_ids].sort(),
    task_ids: [...input.task_ids].sort(),
    decision_ids: [...input.decision_ids].sort(),
  })

  let hash = 2166136261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function assertWriterLeaseAvailable(
  current: MissionWriterLease | null,
  holderId: string,
  now = new Date(),
): void {
  if (!current) return
  const expiresAt = Date.parse(current.expires_at)
  if (!Number.isFinite(expiresAt)) throw new Error('Mission writer lease has an invalid expires_at')
  if (expiresAt <= now.getTime()) return
  if (current.holder_id === holderId) return
  throw new Error(`Mission writer lease is held by ${current.holder_id} until ${current.expires_at}`)
}
