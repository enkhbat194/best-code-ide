export type ApprovalStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'superseded'
  | 'commit_prepared'
  | 'pushed'
  | 'pull_request_opened'
  | 'completed'

export type ChangeAction = 'create' | 'update' | 'delete'
export type RiskLevel = 'normal' | 'high'
export type TaskKind = 'build' | 'test' | 'deployment'
export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type ProjectTaskStatus =
  | 'planned'
  | 'inspecting'
  | 'editing'
  | 'awaiting_approval'
  | 'validating'
  | 'pull_request'
  | 'merged'
  | 'deployed'
  | 'completed'
  | 'blocked'
  | 'cancelled'

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
  base_context_sha?: string
  decided_at?: string
  decision?: 'approved' | 'rejected'
  decision_actor?: string
  decision_idempotency_key?: string
  expired_at?: string
  superseded_at?: string
  superseded_reason?: string
  parent_sha?: string
  prepared_commit_sha?: string
  prepared_commit_url?: string
  pushed_at?: string
  pr_number?: number
  pr_url?: string
  completed_at?: string
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

export interface ProjectTaskRecord {
  task_id: string
  project_id: string
  goal: string
  status: ProjectTaskStatus
  created_by: string
  branch?: string
  summary?: string
  next_action?: string
  evidence: string[]
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface ProjectHandoffRecord {
  handoff_id: string
  project_id: string
  task_id: string
  from_agent: string
  to_agent?: string
  summary: string
  next_actions: string[]
  evidence: string[]
  created_at: string
}

interface DecisionRequest {
  decision: 'approved' | 'rejected'
  actor?: string
  idempotency_key?: string
}

interface SupersedeRequest {
  reason?: string
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

function projectTaskKey(id: string): string {
  return `project-task:${id}`
}

function handoffKey(id: string): string {
  return `handoff:${id}`
}

function validId(value: string): boolean {
  return /^[a-f0-9-]{16,64}$/i.test(value)
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{16,128}$/.test(value)
}

function isExpired(operation: ApprovalOperation): boolean {
  return operation.status === 'pending_approval' && Date.parse(operation.expires_at) <= Date.now()
}

const PROJECT_TASK_STATUSES = new Set<ProjectTaskStatus>([
  'planned',
  'inspecting',
  'editing',
  'awaiting_approval',
  'validating',
  'pull_request',
  'merged',
  'deployed',
  'completed',
  'blocked',
  'cancelled',
])

const PROJECT_TASK_TRANSITIONS: Record<ProjectTaskStatus, ProjectTaskStatus[]> = {
  planned: ['inspecting', 'blocked', 'cancelled'],
  inspecting: ['editing', 'blocked', 'cancelled'],
  editing: ['awaiting_approval', 'validating', 'blocked', 'cancelled'],
  awaiting_approval: ['editing', 'validating', 'blocked', 'cancelled'],
  validating: ['editing', 'pull_request', 'blocked', 'cancelled'],
  pull_request: ['merged', 'blocked', 'cancelled'],
  merged: ['deployed', 'completed', 'blocked'],
  deployed: ['completed', 'blocked'],
  blocked: ['inspecting', 'editing', 'awaiting_approval', 'validating', 'cancelled'],
  completed: [],
  cancelled: [],
}

export function isProjectTaskTransitionAllowed(from: ProjectTaskStatus, to: ProjectTaskStatus): boolean {
  return from === to || PROJECT_TASK_TRANSITIONS[from].includes(to)
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, max)
}

function cleanStringList(value: unknown, maxItems = 20, maxChars = 500): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxChars))
    .filter(Boolean))]
    .slice(0, maxItems)
}

function validProjectTaskStatus(value: unknown): value is ProjectTaskStatus {
  return typeof value === 'string' && PROJECT_TASK_STATUSES.has(value as ProjectTaskStatus)
}

export class ApprovalStore {
  constructor(private readonly state: DurableObjectState) {}

  private async readOperation(id: string): Promise<ApprovalOperation | null> {
    const operation = await this.state.storage.get<ApprovalOperation>(operationKey(id))
    if (!operation) return null
    if (isExpired(operation)) {
      const now = new Date().toISOString()
      const updated: ApprovalOperation = { ...operation, status: 'expired', updated_at: now, expired_at: now }
      await this.state.storage.put(operationKey(id), updated)
      return updated
    }
    return operation
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)

    if (request.method === 'POST' && url.pathname === '/project-tasks') {
      const task = (await request.json().catch(() => null)) as ProjectTaskRecord | null
      if (!task || !validId(task.task_id)) return json({ error: 'A valid task_id is required' }, 400)
      const projectId = cleanString(task.project_id, 64)
      const goal = cleanString(task.goal, 2000)
      const createdBy = cleanString(task.created_by, 80)
      if (!projectId || !goal || !createdBy) return json({ error: 'project_id, goal, and created_by are required' }, 400)
      if (task.status !== 'planned') return json({ error: 'A new project task must start in planned status' }, 409)
      if (await this.state.storage.get(projectTaskKey(task.task_id))) return json({ error: 'Project task already exists' }, 409)
      const normalized: ProjectTaskRecord = {
        ...task,
        project_id: projectId,
        goal,
        created_by: createdBy,
        status: 'planned',
        branch: cleanString(task.branch, 160),
        summary: cleanString(task.summary, 4000),
        next_action: cleanString(task.next_action, 1000),
        evidence: cleanStringList(task.evidence),
      }
      await this.state.storage.put(projectTaskKey(task.task_id), normalized)
      return json(normalized, 201)
    }

    if (request.method === 'GET' && url.pathname === '/project-tasks') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '30'), 1), 100)
      const projectId = url.searchParams.get('project_id')
      const status = url.searchParams.get('status')
      const values = await this.state.storage.list<ProjectTaskRecord>({ prefix: 'project-task:' })
      const tasks = [...values.values()]
        .filter((task) => (!projectId || task.project_id === projectId) && (!status || task.status === status))
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      return json({ items: tasks.slice(0, limit), count: Math.min(tasks.length, limit), total: tasks.length })
    }

    if (segments[0] === 'project-tasks' && segments[1]) {
      const taskId = segments[1]
      if (!validId(taskId)) return json({ error: 'Invalid project task id' }, 400)
      const task = await this.state.storage.get<ProjectTaskRecord>(projectTaskKey(taskId))
      if (!task) return json({ error: 'Project task not found' }, 404)
      if (request.method === 'GET' && segments.length === 2) return json(task)
      if (request.method === 'POST' && segments[2] === 'update') {
        const body = (await request.json().catch(() => null)) as Partial<ProjectTaskRecord> | null
        if (!body) return json({ error: 'Project task update body is required' }, 400)
        const nextStatus = body.status ?? task.status
        if (!validProjectTaskStatus(nextStatus)) return json({ error: 'Invalid project task status' }, 400)
        if (!isProjectTaskTransitionAllowed(task.status, nextStatus)) {
          return json({ error: `Project task cannot move from ${task.status} to ${nextStatus}` }, 409)
        }
        const evidence = body.evidence === undefined ? task.evidence : cleanStringList(body.evidence)
        const summary = body.summary === undefined ? task.summary : cleanString(body.summary, 4000)
        if (nextStatus === 'completed' && (!summary || evidence.length === 0)) {
          return json({ error: 'Completed project tasks require a summary and at least one evidence reference' }, 409)
        }
        const now = new Date().toISOString()
        const updated: ProjectTaskRecord = {
          ...task,
          status: nextStatus,
          branch: body.branch === undefined ? task.branch : cleanString(body.branch, 160),
          summary,
          next_action: body.next_action === undefined ? task.next_action : cleanString(body.next_action, 1000),
          evidence,
          updated_at: now,
          ...(nextStatus === 'completed' ? { completed_at: task.completed_at ?? now } : {}),
        }
        await this.state.storage.put(projectTaskKey(taskId), updated)
        return json(updated)
      }
    }

    if (request.method === 'POST' && url.pathname === '/handoffs') {
      const handoff = (await request.json().catch(() => null)) as ProjectHandoffRecord | null
      if (!handoff || !validId(handoff.handoff_id) || !validId(handoff.task_id)) {
        return json({ error: 'Valid handoff_id and task_id are required' }, 400)
      }
      const task = await this.state.storage.get<ProjectTaskRecord>(projectTaskKey(handoff.task_id))
      if (!task) return json({ error: 'Project task not found' }, 404)
      const projectId = cleanString(handoff.project_id, 64)
      const fromAgent = cleanString(handoff.from_agent, 80)
      const summary = cleanString(handoff.summary, 4000)
      if (!projectId || projectId !== task.project_id || !fromAgent || !summary) {
        return json({ error: 'Handoff must match the task project and include from_agent and summary' }, 409)
      }
      if (await this.state.storage.get(handoffKey(handoff.handoff_id))) return json({ error: 'Handoff already exists' }, 409)
      const normalized: ProjectHandoffRecord = {
        ...handoff,
        project_id: projectId,
        from_agent: fromAgent,
        to_agent: cleanString(handoff.to_agent, 80),
        summary,
        next_actions: cleanStringList(handoff.next_actions, 20, 1000),
        evidence: cleanStringList(handoff.evidence),
      }
      await this.state.storage.put(handoffKey(handoff.handoff_id), normalized)
      return json(normalized, 201)
    }

    if (request.method === 'GET' && url.pathname === '/handoffs') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20'), 1), 100)
      const projectId = url.searchParams.get('project_id')
      const taskId = url.searchParams.get('task_id')
      const values = await this.state.storage.list<ProjectHandoffRecord>({ prefix: 'handoff:' })
      const handoffs = [...values.values()]
        .filter((item) => (!projectId || item.project_id === projectId) && (!taskId || item.task_id === taskId))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      return json({ items: handoffs.slice(0, limit), count: Math.min(handoffs.length, limit), total: handoffs.length })
    }

    if (request.method === 'POST' && url.pathname === '/operations') {
      const operation = (await request.json().catch(() => null)) as ApprovalOperation | null
      if (!operation || !validId(operation.operation_id)) return json({ error: 'A valid operation_id is required' }, 400)
      if (operation.status !== 'pending_approval' || operation.approval_required !== true) {
        return json({ error: 'A new approval operation must start in pending_approval status' }, 409)
      }
      if (!Number.isFinite(Date.parse(operation.expires_at)) || Date.parse(operation.expires_at) <= Date.now()) {
        return json({ error: 'A new approval operation requires a future expires_at' }, 400)
      }
      if (
        operation.decided_at || operation.decision || operation.decision_actor || operation.decision_idempotency_key ||
        operation.expired_at || operation.superseded_at || operation.superseded_reason ||
        operation.parent_sha || operation.prepared_commit_sha || operation.prepared_commit_url ||
        operation.pushed_at || operation.pr_number || operation.pr_url || operation.completed_at
      ) {
        return json({ error: 'A new approval operation cannot contain terminal or execution state' }, 409)
      }
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
        const now = new Date().toISOString()
        const current = isExpired(value)
          ? { ...value, status: 'expired' as const, updated_at: now, expired_at: now }
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
        const actor = cleanString(body.actor, 80) ?? 'bestcode-user'
        const suppliedKey = typeof body.idempotency_key === 'string'
          ? body.idempotency_key.trim()
          : undefined
        if (suppliedKey && !validIdempotencyKey(suppliedKey)) {
          return json({ error: 'idempotency_key must be 16-128 URL-safe characters' }, 400)
        }
        // Legacy clients are assigned a deterministic key so a cached PWA cannot
        // accidentally create a second transition during a rolling deployment.
        const idempotencyKey = suppliedKey ?? `legacy:${operationId}:${body.decision}`
        if (operation.status !== 'pending_approval') {
          if (
            operation.decision === body.decision &&
            operation.decision_idempotency_key === idempotencyKey
          ) {
            return json(operation)
          }
          return json({ error: `Operation cannot be decided from status ${operation.status}`, operation }, 409)
        }
        const now = new Date().toISOString()
        const updated: ApprovalOperation = {
          ...operation,
          status: body.decision,
          updated_at: now,
          decided_at: now,
          decision: body.decision,
          decision_actor: actor,
          decision_idempotency_key: idempotencyKey,
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }

      if (request.method === 'POST' && segments[2] === 'supersede') {
        const body = (await request.json().catch(() => null)) as SupersedeRequest | null
        const reason = cleanString(body?.reason, 500)
        if (!reason) return json({ error: 'A bounded supersede reason is required' }, 400)
        if (operation.status === 'superseded' && operation.superseded_reason === reason) return json(operation)
        if (!['pending_approval', 'approved'].includes(operation.status)) {
          return json({ error: `Operation cannot be superseded from status ${operation.status}`, operation }, 409)
        }
        const now = new Date().toISOString()
        const updated: ApprovalOperation = {
          ...operation,
          status: 'superseded',
          updated_at: now,
          superseded_at: now,
          superseded_reason: reason,
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


      if (request.method === 'POST' && segments[2] === 'completed') {
        if (operation.status !== 'approved') {
          return json({ error: `Operation cannot complete from status ${operation.status}`, operation }, 409)
        }
        const now = new Date().toISOString()
        const updated: ApprovalOperation = {
          ...operation,
          status: 'completed',
          updated_at: now,
          completed_at: now,
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
