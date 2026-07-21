export interface SecurityAuditEvent {
  audit_id: string
  event: string
  occurred_at: string
  path?: string
  method?: string
  identity?: 'owner' | 'unauthorized' | 'unknown'
  client?: string
  details: Record<string, unknown>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function eventKey(event: SecurityAuditEvent): string {
  return `security-audit:${event.occurred_at}:${event.audit_id}`
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, max)
}

export function normalizeSecurityAuditEvent(value: unknown): SecurityAuditEvent | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const auditId = cleanString(input.audit_id, 64)
  const event = cleanString(input.event, 100)
  const occurredAt = cleanString(input.occurred_at, 40)
  if (!auditId || !/^[a-f0-9-]{16,64}$/i.test(auditId) || !event || !occurredAt) return null
  if (!Number.isFinite(Date.parse(occurredAt))) return null

  const identity = input.identity === 'owner' || input.identity === 'unauthorized' || input.identity === 'unknown'
    ? input.identity
    : undefined
  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details)
    ? input.details as Record<string, unknown>
    : {}

  return {
    audit_id: auditId,
    event,
    occurred_at: new Date(occurredAt).toISOString(),
    path: cleanString(input.path, 500),
    method: cleanString(input.method, 16),
    identity,
    client: cleanString(input.client, 200),
    details,
  }
}

export class SecurityAuditStore {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/events') {
      const event = normalizeSecurityAuditEvent(await request.json().catch(() => null))
      if (!event) return json({ error: 'Invalid security audit event' }, 400)
      const key = eventKey(event)
      if (await this.state.storage.get(key)) return json(event)
      await this.state.storage.put(key, event)

      const values = await this.state.storage.list<SecurityAuditEvent>({ prefix: 'security-audit:' })
      if (values.size > 1000) {
        const overflow = [...values.keys()].sort().slice(0, values.size - 1000)
        if (overflow.length) await this.state.storage.delete(overflow)
      }
      return json(event, 201)
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '100'), 1), 500)
      const eventFilter = url.searchParams.get('event')
      const since = url.searchParams.get('since')
      const sinceMs = since && Number.isFinite(Date.parse(since)) ? Date.parse(since) : undefined
      const values = await this.state.storage.list<SecurityAuditEvent>({ prefix: 'security-audit:', reverse: true })
      const items = [...values.values()]
        .filter((item) => (!eventFilter || item.event === eventFilter) && (sinceMs === undefined || Date.parse(item.occurred_at) >= sinceMs))
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      return json({ items: items.slice(0, limit), count: Math.min(items.length, limit), total: items.length })
    }

    return json({ error: 'Not found' }, 404)
  }
}
