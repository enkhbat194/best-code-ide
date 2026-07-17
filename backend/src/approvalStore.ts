export type ApprovalStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'commit_prepared'
  | 'pushed'
  | 'pull_request_opened'

export type ChangeAction = 'create' | 'update' | 'delete'
export type RiskLevel = 'normal' | 'high'
export type TaskKind = 'build' | 'test' | 'deployment'
export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface StagedChange {
  action: ChangeAction
  path: string
  base_sha: string | null
  base_content: string | null
  proposed_content: string | null
  diff: string
}

export interface ApprovalOperation {
  operation_id: string
  project_id: string
  repository: { owner: string; repo: string; full_name: string }
  branch: string
  title: string
  summary: string
  status: ApprovalStatus
  approval_required: true
  risk: RiskLevel
  risk_reasons: string[]
  changes: StagedChange[]
  created_at: string
  updated_at: string
  expires_at: string
  decided_at?: string
  decision_actor?: string
  parent_sha?: string
  prepared_commit_sha?: string
  prepared_commit_url?: string
  pushed_at?: string
  pr_number?: number
  pr_url?: string
}

export interface TaskRecord {
  task_id: string
  kind: TaskKind
  project_id: string
  operation_id?: string
  repository: { owner: string; repo: string; full_name: string }
  branch: string
  workflow: string
  status: TaskStatus
  conclusion?: string | null
  run_id?: number
  run_url?: string
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
  error?: string
}

interface DecisionRequest {
  decision: 'approved' | 'rejected'
  actor?: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function operationKey(id: string): string {
  return `operation:${id}`
}

function taskKey(id: string): string {
  return `task:${id}`
}

function validId(value: string): boolean {
  return /^[a-f0-9-]{16,64}$/i.test(value)
}

function isExpired(operation: ApprovalOperation): boolean {
  return operation.status === 'pending_approval' && Date.parse(operation.expires_at) <= Date.now()
}

export class ApprovalStore {
  constructor(private readonly state: DurableObjectState) {}

  private async readOperation(id: string): Promise<ApprovalOperation | null> {
    const operation = await this.state.storage.get<ApprovalOperation>(operationKey(id))
    if (!operation) return null
    if (isExpired(operation)) {
      const updated: ApprovalOperation = { ...operation, status: 'expired', updated_at: new Date().toISOString() }
      await this.state.storage.put(operationKey(id), updated)
      return updated
    }
    return operation
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)

    if (request.method === 'POST' && url.pathname === '/operations') {
      const operation = (await request.json().catch(() => null)) as ApprovalOperation | null
      if (!operation || !validId(operation.operation_id)) return json({ error: 'A valid operation_id is required' }, 400)
      if (await this.state.storage.get(operationKey(operation.operation_id))) return json({ error: 'Operation already exists' }, 409)
      await this.state.storage.put(operationKey(operation.operation_id), operation)
      return json(operation, 201)
    }

    if (request.method === 'GET' && url.pathname === '/operations') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 100)
      const status = url.searchParams.get('status')
      const projectId = url.searchParams.get('project_id')
      const values = await this.state.storage.list<ApprovalOperation>({ prefix: 'operation:' })
      const operations: ApprovalOperation[] = []
      for (const value of values.values()) {
        const current = isExpired(value)
          ? { ...value, status: 'expired' as const, updated_at: new Date().toISOString() }
          : value
        if (current !== value) await this.state.storage.put(operationKey(current.operation_id), current)
        if (status && current.status !== status) continue
        if (projectId && current.project_id !== projectId) continue
        operations.push(current)
      }
      operations.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      return json({ items: operations.slice(0, limit), count: Math.min(operations.length, limit), total: operations.length })
    }

    if (segments[0] === 'operations' && segments[1]) {
      const operationId = segments[1]
      if (!validId(operationId)) return json({ error: 'Invalid operation id' }, 400)
      const operation = await this.readOperation(operationId)
      if (!operation) return json({ error: 'Operation not found' }, 404)

      if (request.method === 'GET' && segments.length === 2) return json(operation)

      if (request.method === 'POST' && segments[2] === 'decision') {
        const body = (await request.json().catch(() => null)) as DecisionRequest | null
        if (!body || (body.decision !== 'approved' && body.decision !== 'rejected')) {
          return json({ error: 'decision must be approved or rejected' }, 400)
        }
        if (operation.status !== 'pending_approval') {
          return json({ error: `Operation cannot be decided from status ${operation.status}`, operation }, 409)
        }
        const now = new Date().toISOString()
        const updated: ApprovalOperation = {
          ...operation,
          status: body.decision,
          updated_at: now,
          decided_at: now,
          decision_actor: body.actor?.trim() || 'bestcode-user',
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }

      if (request.method === 'POST' && segments[2] === 'cancel') {
        if (!['pending_approval', 'approved', 'commit_prepared'].includes(operation.status)) {
          return json({ error: `Operation cannot be cancelled from status ${operation.status}`, operation }, 409)
        }
        const updated: ApprovalOperation = { ...operation, status: 'cancelled', updated_at: new Date().toISOString() }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }

      if (request.method === 'POST' && segments[2] === 'prepared') {
        const body = (await request.json().catch(() => null)) as {
          parent_sha?: string
          commit_sha?: string
          commit_url?: string
        } | null
        if (operation.status !== 'approved') {
          return json({ error: `Operation cannot prepare a commit from status ${operation.status}`, operation }, 409)
        }
        if (!body?.parent_sha || !body.commit_sha) return json({ error: 'parent_sha and commit_sha are required' }, 400)
        const updated: ApprovalOperation = {
          ...operation,
          status: 'commit_prepared',
          updated_at: new Date().toISOString(),
          parent_sha: body.parent_sha,
          prepared_commit_sha: body.commit_sha,
          prepared_commit_url: body.commit_url,
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }

      if (request.method === 'POST' && segments[2] === 'pushed') {
        if (operation.status !== 'commit_prepared' || !operation.prepared_commit_sha) {
          return json({ error: `Operation cannot be pushed from status ${operation.status}`, operation }, 409)
        }
        const updated: ApprovalOperation = {
          ...operation,
          status: 'pushed',
          updated_at: new Date().toISOString(),
          pushed_at: new Date().toISOString(),
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }

      if (request.method === 'POST' && segments[2] === 'pull-request') {
        const body = (await request.json().catch(() => null)) as { number?: number; url?: string } | null
        if (operation.status !== 'pushed') {
          return json({ error: `Operation cannot create a pull request from status ${operation.status}`, operation }, 409)
        }
        if (!body?.number || !body.url) return json({ error: 'number and url are required' }, 400)
        const updated: ApprovalOperation = {
          ...operation,
          status: 'pull_request_opened',
          updated_at: new Date().toISOString(),
          pr_number: body.number,
          pr_url: body.url,
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }
    }

    if (request.method === 'POST' && url.pathname === '/tasks') {
      const task = (await request.json().catch(() => null)) as TaskRecord | null
      if (!task || !validId(task.task_id)) return json({ error: 'A valid task_id is required' }, 400)
      if (task.operation_id && !validId(task.operation_id)) return json({ error: 'Invalid operation_id' }, 400)
      if (await this.state.storage.get(taskKey(task.task_id))) return json({ error: 'Task already exists' }, 409)
      await this.state.storage.put(taskKey(task.task_id), task)
      return json(task, 201)
    }

    if (request.method === 'GET' && url.pathname === '/tasks') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 100)
      const kind = url.searchParams.get('kind')
      const projectId = url.searchParams.get('project_id')
      const operationId = url.searchParams.get('operation_id')
      const values = await this.state.storage.list<TaskRecord>({ prefix: 'task:' })
      const tasks = [...values.values()]
        .filter((task) =>
          (!kind || task.kind === kind) &&
          (!projectId || task.project_id === projectId) &&
          (!operationId || task.operation_id === operationId),
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      return json({ items: tasks.slice(0, limit), count: Math.min(tasks.length, limit), total: tasks.length })
    }

    if (segments[0] === 'tasks' && segments[1]) {
      const taskId = segments[1]
      if (!validId(taskId)) return json({ error: 'Invalid task id' }, 400)
      const task = await this.state.storage.get<TaskRecord>(taskKey(taskId))
      if (!task) return json({ error: 'Task not found' }, 404)
      if (request.method === 'GET' && segments.length === 2) return json(task)
      if (request.method === 'POST' && segments[2] === 'update') {
        const body = (await request.json().catch(() => null)) as Partial<TaskRecord> | null
        if (!body) return json({ error: 'Task update body is required' }, 400)
        const updated: TaskRecord = {
          ...task,
          status: body.status ?? task.status,
          conclusion: body.conclusion ?? task.conclusion,
          run_id: body.run_id ?? task.run_id,
          run_url: body.run_url ?? task.run_url,
          started_at: body.started_at ?? task.started_at,
          completed_at: body.completed_at ?? task.completed_at,
          error: body.error ?? task.error,
          updated_at: new Date().toISOString(),
        }
        await this.state.storage.put(taskKey(taskId), updated)
        return json(updated)
      }
    }

    return json({ error: 'Not found' }, 404)
  }
}
