export type ApprovalStatus = 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'committed'
export type ChangeAction = 'create' | 'update' | 'delete'
export type RiskLevel = 'normal' | 'high'

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
  commit_sha?: string
  commit_url?: string
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

function validOperationId(value: string): boolean {
  return /^[a-f0-9-]{16,64}$/i.test(value)
}

function isExpired(operation: ApprovalOperation): boolean {
  return operation.status === 'pending_approval' && Date.parse(operation.expires_at) <= Date.now()
}

export class ApprovalStore {
  constructor(private readonly state: DurableObjectState) {}

  private async read(id: string): Promise<ApprovalOperation | null> {
    const operation = await this.state.storage.get<ApprovalOperation>(operationKey(id))
    if (!operation) return null
    if (isExpired(operation)) {
      const updated: ApprovalOperation = {
        ...operation,
        status: 'expired',
        updated_at: new Date().toISOString(),
      }
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
      if (!operation || !validOperationId(operation.operation_id)) {
        return json({ error: 'A valid operation_id is required' }, 400)
      }
      if (await this.state.storage.get(operationKey(operation.operation_id))) {
        return json({ error: 'Operation already exists' }, 409)
      }
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
      if (!validOperationId(operationId)) return json({ error: 'Invalid operation id' }, 400)
      const operation = await this.read(operationId)
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
        if (operation.status !== 'pending_approval' && operation.status !== 'approved') {
          return json({ error: `Operation cannot be cancelled from status ${operation.status}`, operation }, 409)
        }
        const updated: ApprovalOperation = {
          ...operation,
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }

      if (request.method === 'POST' && segments[2] === 'committed') {
        const body = (await request.json().catch(() => null)) as { commit_sha?: string; commit_url?: string } | null
        if (operation.status !== 'approved') {
          return json({ error: `Operation cannot be committed from status ${operation.status}`, operation }, 409)
        }
        if (!body?.commit_sha) return json({ error: 'commit_sha is required' }, 400)
        const updated: ApprovalOperation = {
          ...operation,
          status: 'committed',
          updated_at: new Date().toISOString(),
          commit_sha: body.commit_sha,
          commit_url: body.commit_url,
        }
        await this.state.storage.put(operationKey(operationId), updated)
        return json(updated)
      }
    }

    return json({ error: 'Not found' }, 404)
  }
}
