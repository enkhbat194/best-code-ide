import {
  SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION,
  SUBSCRIPTION_CREDENTIAL_VERSION,
  SUBSCRIPTION_PROFILE,
  SUBSCRIPTION_TOOL_SET_VERSION,
  type PublicSubscriptionCredential,
  type SubscriptionCredentialRecord,
  type SubscriptionCredentialStatus,
} from './subscriptionCredentialTypes'
import {
  BOUNDED_WRITE_CREDENTIAL_SCHEMA_VERSION,
  BOUNDED_WRITE_CREDENTIAL_VERSION,
  BOUNDED_WRITE_PROFILE,
  boundedWriteCredentialStatus,
  boundedWriteScopePayload,
  publicBoundedWriteCredential,
  type BoundedWriteCredentialRecord,
} from './boundedWriteCredentialTypes'

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
const BOUNDED_WRITE_CREDENTIAL_PREFIX = 'bounded-write-credential:'
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

function boundedWriteCredentialKey(credentialId: string): string {
  return `${BOUNDED_WRITE_CREDENTIAL_PREFIX}${credentialId}`
}

function boundedWriteIdempotencyKey(credentialId: string, namespace: string, key: string): string {
  return `bounded-write-idempotency:${credentialId}:${namespace}:${key}`
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function normalizeBoundedWriteCredentialRecord(value: unknown): BoundedWriteCredentialRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, any>
  const stringFields = [
    'credential_id', 'project_id', 'mission_id', 'execution_plan_id', 'task_id', 'attempt_id',
    'lease_id', 'agent_id', 'provider', 'branch', 'base_sha', 'idempotency_namespace',
    'approval_record_id', 'scope_hash', 'secret_hash',
  ] as const
  if (stringFields.some((field) => !cleanString(input[field], field === 'branch' ? 160 : 200))) return null
  if (
    input.schema_version !== BOUNDED_WRITE_CREDENTIAL_SCHEMA_VERSION ||
    input.credential_version !== BOUNDED_WRITE_CREDENTIAL_VERSION ||
    input.profile !== BOUNDED_WRITE_PROFILE ||
    input.safety_class !== 'repository-bounded-write' ||
    !/^[a-f0-9-]{36}$/i.test(input.credential_id) ||
    !/^[a-f0-9]{40,64}$/i.test(input.base_sha) ||
    !/^[a-f0-9]{64}$/i.test(input.scope_hash) ||
    !/^[a-f0-9]{64}$/i.test(input.secret_hash) ||
    !Number.isSafeInteger(input.fencing_token) || input.fencing_token < 1
  ) return null
  const issuedAt = cleanDate(input.issued_at)
  const expiresAt = cleanDate(input.expires_at)
  const revokedAt = input.revoked_at === undefined ? undefined : cleanDate(input.revoked_at)
  const allowedTools = cleanStringList(input.allowed_tools, 100, 200)
  const allowedPaths = cleanStringList(input.allowed_paths, 100, 300)
  const deniedPaths = cleanStringList(input.denied_paths, 100, 300)
  const limitKeys = ['max_operations', 'max_changed_files', 'max_total_changed_bytes', 'max_commits', 'max_pushes', 'max_pull_requests']
  const usageKeys = ['operations', 'changed_files', 'total_changed_bytes', 'commits', 'pushes', 'pull_requests']
  if (
    !issuedAt || !expiresAt || Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    (input.revoked_at !== undefined && !revokedAt) ||
    !allowedTools?.length || !allowedPaths?.length || !deniedPaths?.length ||
    !input.limits || limitKeys.some((key) => !Number.isSafeInteger(input.limits[key]) || input.limits[key] < 1) ||
    !input.usage || usageKeys.some((key) => !Number.isSafeInteger(input.usage[key]) || input.usage[key] < 0)
  ) return null
  return {
    ...input,
    issued_at: issuedAt,
    expires_at: expiresAt,
    ...(revokedAt ? { revoked_at: revokedAt } : {}),
    allowed_tools: allowedTools,
    allowed_paths: allowedPaths,
    denied_paths: deniedPaths,
    scope_hash: input.scope_hash.toLowerCase(),
    secret_hash: input.secret_hash.toLowerCase(),
  } as BoundedWriteCredentialRecord
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

    if (request.method === 'POST' && url.pathname === '/bounded-write-credentials') {
      const record = normalizeBoundedWriteCredentialRecord(await request.json().catch(() => null))
      if (!record) return json({ error: 'Invalid bounded write credential record' }, 400)
      if (Date.parse(record.expires_at) - Date.parse(record.issued_at) > 7_200_000) {
        return json({ error: 'Bounded write credential TTL exceeds maximum' }, 400)
      }
      const key = boundedWriteCredentialKey(record.credential_id)
      if (await this.state.storage.get(key)) return json({ error: 'Credential already exists' }, 409)
      await this.state.storage.put(key, record)
      return json({ credential: publicBoundedWriteCredential(record, record.issued_at) }, 201)
    }

    if (request.method === 'GET' && url.pathname === '/bounded-write-credentials') {
      const projectId = cleanString(url.searchParams.get('project_id'), 64)
      const missionId = cleanString(url.searchParams.get('mission_id'), 64)
      const taskId = cleanString(url.searchParams.get('task_id'), 64)
      const values = await this.state.storage.list<BoundedWriteCredentialRecord>({ prefix: BOUNDED_WRITE_CREDENTIAL_PREFIX })
      const items = [...values.values()]
        .filter((item) =>
          (!projectId || item.project_id === projectId) &&
          (!missionId || item.mission_id === missionId) &&
          (!taskId || item.task_id === taskId))
        .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at))
        .map((item) => publicBoundedWriteCredential(item))
      return json({ items, count: items.length })
    }

    if (request.method === 'POST' && url.pathname === '/bounded-write-credentials/authenticate') {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      const credentialId = cleanString(input?.credential_id, 64) ?? ''
      const presentedHash = cleanString(input?.presented_hash, 64) ?? DUMMY_SECRET_HASH
      const endpoint = cleanString(input?.endpoint, 200) ?? ''
      const projectId = cleanString(input?.project_id, 64) ?? ''
      const now = safeNow(input?.now)
      const record = credentialId
        ? await this.state.storage.get<BoundedWriteCredentialRecord>(boundedWriteCredentialKey(credentialId))
        : undefined
      const scopeHash = record
        ? await sha256Hex(JSON.stringify(boundedWriteScopePayload(record)))
        : DUMMY_SECRET_HASH
      const valid = Boolean(
        record &&
        constantTimeHexEqual(record.secret_hash, presentedHash) &&
        constantTimeHexEqual(record.scope_hash, scopeHash) &&
        boundedWriteCredentialStatus(record, now) === 'active' &&
        endpoint === '/mcp/subscription' &&
        projectId === record.project_id &&
        record.profile === BOUNDED_WRITE_PROFILE,
      )
      if (!valid || !record) return json({ ok: false, code: 'INVALID_BOUNDED_WRITE_CREDENTIAL' }, 401)
      const { secret_hash: _secretHash, issued_at: _issuedAt, revoked_at: _revokedAt, ...principal } = record
      return json({ ok: true, principal })
    }

    const boundedWriteMatch = url.pathname.match(/^\/bounded-write-credentials\/([a-f0-9-]{36})(?:\/(revoke|authorize-operation))?$/i)
    if (boundedWriteMatch) {
      const key = boundedWriteCredentialKey(boundedWriteMatch[1])
      const record = await this.state.storage.get<BoundedWriteCredentialRecord>(key)
      if (!record) return json({ error: 'Credential not found' }, 404)
      if (request.method === 'GET' && !boundedWriteMatch[2]) {
        return json({ credential: publicBoundedWriteCredential(record) })
      }
      if (request.method === 'POST' && boundedWriteMatch[2] === 'revoke') {
        const revokedAt = record.revoked_at ?? new Date().toISOString()
        const updated = { ...record, revoked_at: revokedAt }
        await this.state.storage.put(key, updated)
        return json({ credential: publicBoundedWriteCredential(updated, revokedAt) })
      }
      if (request.method === 'POST' && boundedWriteMatch[2] === 'authorize-operation') {
        const input = await request.json().catch(() => null) as Record<string, unknown> | null
        const now = safeNow(input?.now)
        if (boundedWriteCredentialStatus(record, now) !== 'active') return json({ code: 'CREDENTIAL_INACTIVE' }, 403)
        const scopeHash = cleanString(input?.scope_hash, 64) ?? ''
        if (!constantTimeHexEqual(record.scope_hash, scopeHash)) return json({ code: 'SCOPE_HASH_MISMATCH' }, 403)
        const tool = cleanString(input?.tool, 200) ?? ''
        if (!record.allowed_tools.includes(tool)) return json({ code: 'TOOL_SCOPE_DENIED' }, 403)
        const idempotencyKey = cleanString(input?.idempotency_key, 128) ?? ''
        if (!idempotencyKey) return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400)
        const replayKey = boundedWriteIdempotencyKey(record.credential_id, record.idempotency_namespace, idempotencyKey)
        const replay = await this.state.storage.get<{ tool: string; usage: BoundedWriteCredentialRecord['usage'] }>(replayKey)
        if (replay) {
          if (replay.tool !== tool) return json({ code: 'IDEMPOTENCY_KEY_CONFLICT' }, 409)
          return json({ ok: true, replayed: true, usage: replay.usage })
        }
        const integer = (key: string) => {
          const value = Number(input?.[key] ?? 0)
          return Number.isSafeInteger(value) && value >= 0 ? value : -1
        }
        const delta = {
          operations: 1,
          changed_files: integer('changed_files'),
          total_changed_bytes: integer('changed_bytes'),
          commits: integer('commits'),
          pushes: integer('pushes'),
          pull_requests: integer('pull_requests'),
        }
        if (Object.values(delta).some((value) => value < 0)) return json({ code: 'INVALID_OPERATION_DELTA' }, 400)
        const nextUsage = {
          operations: record.usage.operations + delta.operations,
          changed_files: record.usage.changed_files + delta.changed_files,
          total_changed_bytes: record.usage.total_changed_bytes + delta.total_changed_bytes,
          commits: record.usage.commits + delta.commits,
          pushes: record.usage.pushes + delta.pushes,
          pull_requests: record.usage.pull_requests + delta.pull_requests,
        }
        const exceeded =
          nextUsage.operations > record.limits.max_operations ||
          nextUsage.changed_files > record.limits.max_changed_files ||
          nextUsage.total_changed_bytes > record.limits.max_total_changed_bytes ||
          nextUsage.commits > record.limits.max_commits ||
          nextUsage.pushes > record.limits.max_pushes ||
          nextUsage.pull_requests > record.limits.max_pull_requests
        if (exceeded) return json({ code: 'OPERATION_LIMIT_EXCEEDED', usage: record.usage, limits: record.limits }, 403)
        const updated = { ...record, usage: nextUsage }
        await this.state.storage.put(key, updated)
        await this.state.storage.put(replayKey, { tool, usage: nextUsage })
        return json({ ok: true, replayed: false, usage: nextUsage })
      }
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
