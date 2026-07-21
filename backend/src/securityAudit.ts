import { redactSensitive } from './security'
import type { SecurityAuditEvent } from './securityAuditStore'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

function stub(env: Env): DurableObjectStub {
  if (!env.SECURITY_AUDIT) throw new Error('Security audit storage is not configured')
  return env.SECURITY_AUDIT.get(env.SECURITY_AUDIT.idFromName('bestcode-security-audit-v1'))
}

export function buildSecurityAuditEvent(
  event: string,
  details: Record<string, unknown> = {},
): SecurityAuditEvent {
  const sanitized = redactSensitive(details) as Record<string, unknown>
  return {
    audit_id: crypto.randomUUID(),
    event: event.slice(0, 100),
    occurred_at: new Date().toISOString(),
    path: typeof sanitized.path === 'string' ? sanitized.path.slice(0, 500) : undefined,
    method: typeof sanitized.method === 'string' ? sanitized.method.slice(0, 16) : undefined,
    identity: sanitized.identity === 'owner' || sanitized.identity === 'unauthorized' || sanitized.identity === 'unknown'
      ? sanitized.identity
      : undefined,
    client: typeof sanitized.client === 'string' ? sanitized.client.slice(0, 200) : undefined,
    details: sanitized,
  }
}

export async function persistSecurityAudit(
  env: Env,
  event: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const record = buildSecurityAuditEvent(event, details)
  console.log(JSON.stringify({ type: 'bestcode.security.audit', ...record }))
  if (!env.SECURITY_AUDIT) return
  const response = await stub(env).fetch('https://security-audit-store/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!response.ok) throw new Error(`Security audit store error ${response.status}`)
}

export async function handleSecurityAudit(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/security/audit') return null
  if (req.method !== 'GET') return jsonError('Method not allowed', 405)
  if (!env.SECURITY_AUDIT) return jsonError('Security audit storage is not configured', 503)

  const query = new URLSearchParams()
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '100'), 1), 500)
  query.set('limit', String(limit))
  const event = url.searchParams.get('event')
  const since = url.searchParams.get('since')
  if (event) query.set('event', event.slice(0, 100))
  if (since) query.set('since', since)

  const response = await stub(env).fetch(`https://security-audit-store/events?${query.toString()}`)
  const payload = await response.json().catch(() => null)
  if (!response.ok) return jsonError('Unable to read security audit records', response.status)
  return jsonResponse(payload)
}
