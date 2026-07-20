import { buildAgentRuntimePlan, type AgentTaskNode } from './agentRuntime'
import { jsonError, jsonResponse } from './utils'

const VALID_PRIORITIES = new Set(['critical', 'high', 'normal', 'low', 'background'])
const VALID_STATUSES = new Set(['pending', 'ready', 'running', 'waiting', 'blocked', 'completed', 'failed', 'cancelled'])

function cleanTask(value: unknown): AgentTaskNode {
  if (!value || typeof value !== 'object') throw new Error('Task must be an object')
  const task = value as Record<string, unknown>
  const taskId = typeof task.task_id === 'string' ? task.task_id.trim() : ''
  const title = typeof task.title === 'string' ? task.title.trim() : ''
  const priority = typeof task.priority === 'string' ? task.priority : ''
  const status = typeof task.status === 'string' ? task.status : ''
  const createdAt = typeof task.created_at === 'string' ? task.created_at : ''
  const dependencies = Array.isArray(task.dependency_ids)
    ? task.dependency_ids.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []

  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(taskId)) throw new Error('task_id must be 1-128 URL-safe characters')
  if (!title || title.length > 300) throw new Error(`Task ${taskId || '(unknown)'} requires a title up to 300 characters`)
  if (!VALID_PRIORITIES.has(priority)) throw new Error(`Task ${taskId} has an invalid priority`)
  if (!VALID_STATUSES.has(status)) throw new Error(`Task ${taskId} has an invalid status`)
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error(`Task ${taskId} has an invalid created_at`)
  if (dependencies.length > 50) throw new Error(`Task ${taskId} has too many dependencies`)

  return {
    task_id: taskId,
    title,
    agent_id: typeof task.agent_id === 'string' && task.agent_id.trim() ? task.agent_id.trim().slice(0, 120) : undefined,
    priority: priority as AgentTaskNode['priority'],
    status: status as AgentTaskNode['status'],
    dependency_ids: [...new Set(dependencies)],
    created_at: new Date(createdAt).toISOString(),
  }
}

export async function handleAgentRuntime(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/agent-runtime')) return null

  if (url.pathname === '/api/agent-runtime/plan' && req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => null)) as { tasks?: unknown[] } | null
      if (!body || !Array.isArray(body.tasks)) return jsonError('tasks array is required')
      if (body.tasks.length > 500) return jsonError('Agent Runtime accepts at most 500 tasks per plan', 413)
      const tasks = body.tasks.map(cleanTask)
      const plan = buildAgentRuntimePlan(tasks)
      return jsonResponse({
        generated_at: new Date().toISOString(),
        counts: {
          total: tasks.length,
          ready: plan.ready.length,
          waiting: plan.waiting.length,
          blocked: plan.blocked.length,
          running: plan.running.length,
          completed: plan.completed.length,
        },
        ...plan,
      })
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 409)
    }
  }

  if (url.pathname === '/api/agent-runtime/capabilities' && req.method === 'GET') {
    return jsonResponse({
      version: 'phase-3-foundation-v1',
      priorities: [...VALID_PRIORITIES],
      statuses: [...VALID_STATUSES],
      max_tasks_per_plan: 500,
      durable_storage: false,
      provider_dispatch: false,
    })
  }

  return jsonError('Method not allowed', 405)
}
