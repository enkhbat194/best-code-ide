export type AgentTaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background'

export type AgentTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentTaskNode {
  task_id: string
  title: string
  agent_id?: string
  priority: AgentTaskPriority
  status: AgentTaskStatus
  dependency_ids: string[]
  created_at: string
}

export interface AgentRuntimePlan {
  ready: AgentTaskNode[]
  waiting: AgentTaskNode[]
  blocked: Array<AgentTaskNode & { blocked_reason: string }>
  running: AgentTaskNode[]
  completed: AgentTaskNode[]
}

const PRIORITY_WEIGHT: Record<AgentTaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
}

function compareTasks(left: AgentTaskNode, right: AgentTaskNode): number {
  const priority = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority]
  if (priority !== 0) return priority
  const created = Date.parse(left.created_at) - Date.parse(right.created_at)
  if (created !== 0) return created
  return left.task_id.localeCompare(right.task_id)
}

export function assertValidTaskGraph(tasks: AgentTaskNode[]): void {
  const byId = new Map(tasks.map((task) => [task.task_id, task]))
  if (byId.size !== tasks.length) throw new Error('Agent task graph contains duplicate task_id values')

  for (const task of tasks) {
    if (task.dependency_ids.includes(task.task_id)) throw new Error(`Task ${task.task_id} cannot depend on itself`)
    for (const dependencyId of task.dependency_ids) {
      if (!byId.has(dependencyId)) throw new Error(`Task ${task.task_id} depends on missing task ${dependencyId}`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) throw new Error(`Agent task graph contains a dependency cycle at ${taskId}`)
    if (visited.has(taskId)) return
    visiting.add(taskId)
    for (const dependencyId of byId.get(taskId)?.dependency_ids ?? []) visit(dependencyId)
    visiting.delete(taskId)
    visited.add(taskId)
  }
  for (const task of tasks) visit(task.task_id)
}

export function buildAgentRuntimePlan(tasks: AgentTaskNode[]): AgentRuntimePlan {
  assertValidTaskGraph(tasks)
  const byId = new Map(tasks.map((task) => [task.task_id, task]))
  const plan: AgentRuntimePlan = { ready: [], waiting: [], blocked: [], running: [], completed: [] }

  for (const task of tasks) {
    if (task.status === 'running') {
      plan.running.push(task)
      continue
    }
    if (task.status === 'completed') {
      plan.completed.push(task)
      continue
    }
    if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'blocked') {
      plan.blocked.push({ ...task, blocked_reason: `task is ${task.status}` })
      continue
    }

    const dependencies = task.dependency_ids.map((id) => byId.get(id)!)
    const failedDependency = dependencies.find((dependency) =>
      dependency.status === 'failed' || dependency.status === 'cancelled' || dependency.status === 'blocked')
    if (failedDependency) {
      plan.blocked.push({ ...task, blocked_reason: `dependency ${failedDependency.task_id} is ${failedDependency.status}` })
      continue
    }

    if (dependencies.every((dependency) => dependency.status === 'completed')) plan.ready.push({ ...task, status: 'ready' })
    else plan.waiting.push({ ...task, status: 'waiting' })
  }

  plan.ready.sort(compareTasks)
  plan.waiting.sort(compareTasks)
  plan.blocked.sort(compareTasks)
  plan.running.sort(compareTasks)
  plan.completed.sort(compareTasks)
  return plan
}
