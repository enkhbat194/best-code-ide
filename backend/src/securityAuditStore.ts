import {
  SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION,
  SUBSCRIPTION_CREDENTIAL_VERSION,
  SUBSCRIPTION_PROFILE,
  SUBSCRIPTION_TOOL_SET_VERSION,
  type PublicSubscriptionCredential,
  type SubscriptionCredentialRecord,
  type SubscriptionCredentialStatus,
} from './subscriptionCredentialTypes'

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

const CREDENTIAL_PREFIX = 'subscription-credential:'
const DUMMY_SECRET_HASH = '0'.repeat(64)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function eventKey(event: SecurityAuditEvent): string {
  return `security-audit:${event.occurred_at}:${event.audit_id}`
}

function credentialKey(credentialId: string): string {
  return `${CREDENTIAL_PREFIX}${credentialId}`
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, max)
}

function cleanDate(value: unknown): string | undefined {
  const text = cleanString(value, 40)
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : undefined
}

function cleanStringList(value: unknown, maxItems = 100, maxChars = 160): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined
  const items = value.map((item) => cleanString(item, maxChars))
  if (items.some((item) => !item)) return undefined
  return [...new Set(items as string[])]
}

function safeNow(value: unknown): string {
  const supplied = cleanDate(value)
  return supplied ?? new Date().toISOString()
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const a = /^[a-f0-9]{64}$/i.test(left) ? left.toLowerCase() : DUMMY_SECRET_HASH
  const b = /^[a-f0-9]{64}$/i.test(right) ? right.toLowerCase() : DUMMY_SECRET_HASH
  let difference = 0
  for (let index = 0; index < 64; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

function credentialStatus(record: SubscriptionCredentialRecord, now: string): SubscriptionCredentialStatus {
  if (record.disabled_at) return 'disabled'
  if (record.revoked_at) return 'revoked'
  return Date.parse(now) >= Date.parse(record.expires_at) ? 'expired' : 'active'
}

function publicCredential(record: SubscriptionCredentialRecord, now = new Date().toISOString()): PublicSubscriptionCredential {
  const { secret_hash: _secretHash, ...safe } = record
  return { ...safe, status: credentialStatus(record, now) }
}

function normalizeCredentialRecord(value: unknown): SubscriptionCredentialRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const credentialId = cleanString(input.credential_id, 64)
  const projectId = cleanString(input.project_id, 64)
  const subjectAgentId = cleanString(input.subject_agent_id, 160)
  const agentProvider = cleanString(input.agent_provider, 80)
  const allowedTools = cleanStringList(input.allowed_tools)
  const issuedAt = cleanDate(input.issued_at)
  const expiresAt = cleanDate(input.expires_at)
  const revokedAt = input.revoked_at === undefined ? undefined : cleanDate(input.revoked_at)
  const disabledAt = input.disabled_at === undefined ? undefined : cleanDate(input.disabled_at)
  const createdBy = cleanString(input.created_by_owner_identity, 160)
  const lastUsedAt = input.last_used_at === undefined ? undefined : cleanDate(input.last_used_at)
  const note = input.note === undefined ? undefined : cleanString(input.note, 500)
  const secretHash = cleanString(input.secret_hash, 64)
  const requestCount = Number(input.request_count)
  const auditMetadata = input.audit_metadata && typeof input.audit_metadata === 'object' && !Array.isArray(input.audit_metadata)
    ? input.audit_metadata as Record<string, unknown>
    : null

  if (
    input.schema_version !== SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION ||
    !credentialId || !/^[a-f0-9-]{36}$/i.test(credentialId) ||
    !projectId || !/^[A-Za-z0-9._-]{1,64}$/.test(projectId) ||
    !subjectAgentId || !/^[A-Za-z0-9._:@/-]{1,160}$/.test(subjectAgentId) ||
    !agentProvider || !/^[A-Za-z0-9._:@/-]{1,80}$/.test(agentProvider) ||
    input.allowed_mcp_profile !== SUBSCRIPTION_PROFILE ||
    input.tool_set_version !== SUBSCRIPTION_TOOL_SET_VERSION ||
    !allowedTools || allowedTools.length === 0 ||
    !issuedAt || !expiresAt || Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    (input.revoked_at !== undefined && !revokedAt) ||
    (input.disabled_at !== undefined && !disabledAt) ||
    !createdBy ||
    (input.last_used_at !== undefined && !lastUsedAt) ||
    !Number.isSafeInteger(requestCount) || requestCount < 0 ||
    input.credential_version !== SUBSCRIPTION_CREDENTIAL_VERSION ||
    (input.note !== undefined && !note) ||
    !auditMetadata ||
    typeof auditMetadata.rate_limit_policy !== 'string' ||
    !secretHash || !/^[a-f0-9]{64}$/i.test(secretHash)
  ) return null

  return {
    schema_version: SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION,
    credential_id: credentialId,
    project_id: projectId,
    subject_agent_id: subjectAgentId,
    agent_provider: agentProvider,
    allowed_mcp_profile: SUBSCRIPTION_PROFILE,
    allowed_tools: allowedTools,
    tool_set_version: SUBSCRIPTION_TOOL_SET_VERSION,
    issued_at: issuedAt,
    expires_at: expiresAt,
    ...(revokedAt ? { revoked_at: revokedAt } : {}),
    ...(disabledAt ? { disabled_at: disabledAt } : {}),
    created_by_owner_identity: createdBy,
    ...(lastUsedAt ? { last_used_at: lastUsedAt } : {}),
    request_count: requestCount,
    credential_version: SUBSCRIPTION_CREDENTIAL_VERSION,
    ...(note ? { note } : {}),
    audit_metadata: auditMetadata as SubscriptionCredentialRecord['audit_metadata'],
    secret_hash: secretHash.toLowerCase(),
  }
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

    if (request.method === 'POST' && url.pathname === '/subscription-credentials') {
      const record = normalizeCredentialRecord(await request.json().catch(() => null))
      if (!record) return json({ error: 'Invalid subscription credential record' }, 400)
      const key = credentialKey(record.credential_id)
      if (await this.state.storage.get(key)) return json({ error: 'Credential already exists' }, 409)
      await this.state.storage.put(key, record)
      return json({ credential: publicCredential(record, record.issued_at) }, 201)
    }

    if (request.method === 'GET' && url.pathname === '/subscription-credentials') {
      const projectId = cleanString(url.searchParams.get('project_id'), 64)
      const values = await this.state.storage.list<SubscriptionCredentialRecord>({ prefix: CREDENTIAL_PREFIX })
      const items = [...values.values()]
        .filter((item) => !projectId || item.project_id === projectId)
        .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at))
        .map((item) => publicCredential(item))
      return json({ items, count: items.length })
    }

    if (request.method === 'POST' && url.pathname === '/subscription-credentials/authenticate') {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      const credentialId = cleanString(input?.credential_id, 64) ?? ''
      const presentedHash = cleanString(input?.presented_hash, 64) ?? DUMMY_SECRET_HASH
      const endpoint = cleanString(input?.endpoint, 200) ?? ''
      const projectId = cleanString(input?.project_id, 64) ?? ''
      const profile = cleanString(input?.profile, 80) ?? ''
      const now = safeNow(input?.now)
      const record = credentialId
        ? await this.state.storage.get<SubscriptionCredentialRecord>(credentialKey(credentialId))
        : undefined
      const hashMatches = constantTimeHexEqual(record?.secret_hash ?? DUMMY_SECRET_HASH, presentedHash)
      const status = record ? credentialStatus(record, now) : 'expired'
      const valid = Boolean(
        record &&
        hashMatches &&
        status === 'active' &&
        endpoint === '/mcp/subscription' &&
        projectId === record.project_id &&
        profile === record.allowed_mcp_profile,
      )
      if (!valid || !record) return json({ ok: false, code: 'INVALID_SCOPED_CREDENTIAL' }, 401)

      const updated: SubscriptionCredentialRecord = {
        ...record,
        last_used_at: now,
        request_count: record.request_count + 1,
      }
      await this.state.storage.put(credentialKey(record.credential_id), updated)
      return json({
        ok: true,
        principal: {
          credential_id: updated.credential_id,
          project_id: updated.project_id,
          agent_id: updated.subject_agent_id,
          provider: updated.agent_provider,
          profile: updated.allowed_mcp_profile,
          allowed_tools: updated.allowed_tools,
          tool_set_version: updated.tool_set_version,
          credential_version: updated.credential_version,
          issued_at: updated.issued_at,
          expires_at: updated.expires_at,
        },
      })
    }

    const credentialMatch = url.pathname.match(/^\/subscription-credentials\/([a-f0-9-]{36})(?:\/(revoke))?$/i)
    if (credentialMatch) {
      const credentialId = credentialMatch[1]
      const operation = credentialMatch[2]
      const key = credentialKey(credentialId)
      const record = await this.state.storage.get<SubscriptionCredentialRecord>(key)
      if (!record) return json({ error: 'Credential not found' }, 404)

      if (request.method === 'GET' && !operation) return json({ credential: publicCredential(record) })

      if (request.method === 'POST' && operation === 'revoke') {
        const input = await request.json().catch(() => null) as Record<string, unknown> | null
        const revokedAt = record.revoked_at ?? safeNow(input?.revoked_at)
        const updated = { ...record, revoked_at: revokedAt }
        await this.state.storage.put(key, updated)
        return json({ credential: publicCredential(updated, revokedAt) })
      }
    }

    return json({ error: 'Not found' }, 404)
  }
}
