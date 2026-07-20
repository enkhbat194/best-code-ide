import { buildAgentRuntimePlan, type AgentTaskNode } from './agentRuntime'
import { createAgentTask, getAgentTask, listAgentTasks, updateAgentTask } from './agentRuntimeStore'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

const VALID_PRIORITIES = new Set(['critical', 'high', 'normal', 'low', 'background'])
const VALID_STATUSES = new Set(['pending', 'ready', 'running', 'waiting', 'blocked', 'completed', 'failed', 'cancelled'])

function cleanTask(value: unknown, defaults: Partial<AgentTaskNode> = {}): AgentTaskNode {
  if (!value || typeof value !== 'object') throw new Error('Task must be an object')
  const task = { ...defaults, ...(value as Record<string, unknown>) } as Record<string, unknown>
  const taskId = typeof task.task_id === 'string' ? task.task_id.trim() : ''
  const title = typeof task.title === 'string' ? task.title.trim() : ''
  const priority = typeof task.priority === 'string' ? task.priority : 'normal'
  const status = typeof task.status === 'string' ? task.status : 'pending'
  const createdAt = typeof task.created_at === 'string' ? task.created_at : new Date().toISOString()
  const dependencies = Array.isArray(task.dependency_ids)
    ? task.dependency_ids.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []

  if (!/^[a-f0-9-]{16,64}$/i.test(taskId)) throw new Error('task_id must be a UUID-style 16-64 character identifier')
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

export async function handleAgentRuntime(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/agent-runtime')) return null

  try {
    if (url.pathname === '/api/agent-runtime/plan' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { tasks?: unknown[] } | null
      if (!body || !Array.isArray(body.tasks)) return jsonError('tasks array is required')
      if (body.tasks.length > 500) return jsonError('Agent Runtime accepts at most 500 tasks per plan', 413)
      const tasks = body.tasks.map((item) => cleanTask(item))
      const plan = buildAgentRuntimePlan(tasks)
      return jsonResponse({ generated_at: new Date().toISOString(), counts: {
        total: tasks.length, ready: plan.ready.length, waiting: plan.waiting.length,
        blocked: plan.blocked.length, running: plan.running.length, completed: plan.completed.length,
      }, ...plan })
    }

    if (url.pathname === '/api/agent-runtime/tasks' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body) return jsonError('Task body is required')
      const task = cleanTask({ ...body, task_id: body.task_id ?? crypto.randomUUID(), status: body.status ?? 'pending' })
      const existing = await listAgentTasks(env)
      buildAgentRuntimePlan([...existing, task])
      return jsonResponse(await createAgentTask(env, task), 201)
    }

    if (url.pathname === '/api/agent-runtime/tasks' && req.method === 'GET') {
      const tasks = await listAgentTasks(env, Math.min(Math.max(Number(url.searchParams.get('limit') ?? '100'), 1), 100))
      const status = url.searchParams.get('status')
      const agentId = url.searchParams.get('agent_id')
      const filtered = tasks.filter((task) => (!status || task.status === status) && (!agentId || task.agent_id === agentId))
      return jsonResponse({ items: filtered, count: filtered.length, total: tasks.length })
    }

    const match = url.pathname.match(/^\/api\/agent-runtime\/tasks\/([a-f0-9-]{16,64})(?:\/update)?$/i)
    if (match && req.method === 'GET' && !url.pathname.endsWith('/update')) return jsonResponse(await getAgentTask(env, match[1]))

    if (match && req.method === 'POST' && url.pathname.endsWith('/update')) {
      const current = await getAgentTask(env, match[1])
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body) return jsonError('Task update body is required')
      const updated = cleanTask({ ...current, ...body, task_id: current.task_id, created_at: current.created_at })
      const all = await listAgentTasks(env)
      buildAgentRuntimePlan(all.map((task) => task.task_id === updated.task_id ? updated : task))
      return jsonResponse(await updateAgentTask(env, updated))
    }

    if (url.pathname === '/api/agent-runtime/capabilities' && req.method === 'GET') {
      return jsonResponse({
        version: 'phase-3-foundation-v2', priorities: [...VALID_PRIORITIES], statuses: [...VALID_STATUSES],
        max_tasks_per_plan: 500, durable_storage: true, provider_dispatch: false,
      })
    }

    return jsonError('Method not allowed', 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, /not found/i.test(message) ? 404 : /already exists|cycle|depends|invalid|requires|must/i.test(message) ? 409 : 502)
  }
}
