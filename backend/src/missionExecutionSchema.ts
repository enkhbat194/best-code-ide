export type ExecutionPlanStatus = 'draft' | 'active' | 'superseded' | 'cancelled' | 'completed'
export type ExecutionTaskStatus =
  | 'planned' | 'blocked' | 'ready' | 'leased' | 'running'
  | 'waiting_for_input' | 'waiting_for_approval'
  | 'succeeded' | 'failed' | 'cancelled' | 'superseded'
export type TaskSafetyClass = 'read-only' | 'write-without-approval' | 'approval-required' | 'irreversible'
export type DependencyKind = 'hard' | 'optional'

export interface TaskDependency {
  task_id: string
  kind: DependencyKind
}

export interface ExecutionPlan {
  schema_version: 'bestcode-execution-plan-v1'
  plan_id: string
  project_id: string
  mission_id: string
  objective: string
  generated_from_context_version: number
  generated_from_context_hash: string
  planning_actor: string
  created_at: string
  status: ExecutionPlanStatus
  task_ids: string[]
  dependency_graph: Record<string, TaskDependency[]>
  safety_constraints: string[]
  approval_gates: string[]
  plan_version: number
  supersedes_plan_id: string | null
  evidence_references: string[]
  deterministic_hash: string
}

export interface ExecutionTask {
  schema_version: 'bestcode-execution-task-v1'
  task_id: string
  project_id: string
  mission_id: string
  plan_id: string
  title: string
  objective: string
  scope: string[]
  input_references: string[]
  expected_output: string
  done_criteria: string[]
  dependencies: TaskDependency[]
  status: ExecutionTaskStatus
  safety_class: TaskSafetyClass
  preferred_agent_capabilities: string[]
  assigned_agent_id: string | null
  lease_id: string | null
  attempt_count: number
  max_attempts: number
  timeout_seconds: number
  idempotency_key: string
  progress: number
  result: unknown | null
  evidence_ids: string[]
  blocker: unknown | null
  approval_requirement: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  cancelled_at: string | null
  version: number
}

const TASK_TRANSITIONS: Record<ExecutionTaskStatus, ReadonlySet<ExecutionTaskStatus>> = {
  planned: new Set(['blocked', 'ready', 'cancelled', 'superseded']),
  blocked: new Set(['ready', 'cancelled', 'superseded']),
  ready: new Set(['leased', 'blocked', 'cancelled', 'superseded']),
  leased: new Set(['running', 'ready', 'blocked', 'cancelled']),
  running: new Set(['waiting_for_input', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled']),
  waiting_for_input: new Set(['running', 'failed', 'cancelled']),
  waiting_for_approval: new Set(['running', 'failed', 'cancelled']),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  superseded: new Set(),
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'deterministic_hash' && key !== 'result_hash')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function deterministicExecutionHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')}`
}

export function assertExecutionTaskTransition(from: ExecutionTaskStatus, to: ExecutionTaskStatus): void {
  if (from === to) return
  if (!TASK_TRANSITIONS[from].has(to)) throw new Error(`Execution task transition is not allowed: ${from} -> ${to}`)
}

export function assertExecutionGraph(
  missionId: string,
  tasks: Pick<ExecutionTask, 'task_id' | 'mission_id' | 'dependencies'>[],
): void {
  const byId = new Map(tasks.map((task) => [task.task_id, task]))
  if (byId.size !== tasks.length) throw new Error('Execution graph contains duplicate task IDs')
  for (const task of tasks) {
    if (task.mission_id !== missionId) throw new Error(`Cross-Mission task is not allowed: ${task.task_id}`)
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency.task_id)) throw new Error(`Missing dependency ${dependency.task_id}`)
      if (dependency.task_id === task.task_id) throw new Error(`Task ${task.task_id} cannot depend on itself`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Execution graph contains a cycle at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const edge of byId.get(id)?.dependencies ?? []) visit(edge.task_id)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
}

export function executionTaskReadiness(
  task: Pick<ExecutionTask, 'dependencies'>,
  allTasks: Pick<ExecutionTask, 'task_id' | 'status'>[],
): 'ready' | 'blocked' {
  const statuses = new Map(allTasks.map((item) => [item.task_id, item.status]))
  for (const dependency of task.dependencies) {
    const status = statuses.get(dependency.task_id)
    if (!status) throw new Error(`Missing dependency ${dependency.task_id}`)
    if (dependency.kind === 'hard' && status !== 'succeeded') return 'blocked'
  }
  return 'ready'
}

export function assertExecutionPlan(plan: ExecutionPlan, tasks: ExecutionTask[]): void {
  if (plan.plan_version < 1 || !Number.isInteger(plan.plan_version)) throw new Error('plan_version must be a positive integer')
  if (plan.task_ids.length !== new Set(plan.task_ids).size) throw new Error('Execution plan contains duplicate task IDs')
  if (tasks.some((task) => task.plan_id !== plan.plan_id || task.project_id !== plan.project_id)) {
    throw new Error('Execution plan task scope mismatch')
  }
  if (plan.task_ids.some((id) => !tasks.some((task) => task.task_id === id))) throw new Error('Execution plan references a missing task')
  assertExecutionGraph(plan.mission_id, tasks)
}
