import { getProject } from './projects'
import { sha256Hex } from './subscriptionCredentials'
import type { Env } from './types'
import {
  BOUNDED_WRITE_CREDENTIAL_PREFIX,
  BOUNDED_WRITE_CREDENTIAL_SCHEMA_VERSION,
  BOUNDED_WRITE_CREDENTIAL_VERSION,
  BOUNDED_WRITE_PROFILE,
  DEFAULT_BOUNDED_WRITE_DENIED_PATHS,
  DEFAULT_BOUNDED_WRITE_TTL_SECONDS,
  EMPTY_BOUNDED_WRITE_USAGE,
  MAX_BOUNDED_WRITE_TTL_SECONDS,
  MIN_BOUNDED_WRITE_TTL_SECONDS,
  boundedWriteScopePayload,
  type BoundedWriteCredentialRecord,
  type BoundedWriteLimits,
  type PublicBoundedWriteCredential,
} from './boundedWriteCredentialTypes'

export interface IssueBoundedWriteCredentialInput {
  project_id: string
  mission_id: string
  execution_plan_id: string
  task_id: string
  attempt_id: string
  lease_id: string
  fencing_token: number
  agent_id: string
  provider: string
  branch: string
  base_sha: string
  allowed_tools: string[]
  allowed_paths: string[]
  denied_paths?: string[]
  expires_in_seconds?: number
  limits: BoundedWriteLimits
  idempotency_namespace: string
  approval_record_id: string
}

export interface IssuedBoundedWriteCredential {
  credential: PublicBoundedWriteCredential
  secret: string
}

function storeStub(env: Env): DurableObjectStub {
  if (!env.SECURITY_AUDIT) throw new Error('Bounded write credential storage is not configured')
  return env.SECURITY_AUDIT.get(env.SECURITY_AUDIT.idFromName('bestcode-security-audit-v1'))
}

function identifier(value: unknown, name: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  const result = value.trim()
  if (result.length > max || !/^[A-Za-z0-9._:@/-]+$/.test(result)) throw new Error(`${name} is invalid`)
  return result
}

function sha(value: unknown, name: string): string {
  const result = identifier(value, name, 64).toLowerCase()
  if (!/^[a-f0-9]{40,64}$/.test(result)) throw new Error(`${name} must be a Git SHA`)
  return result
}

function stringList(value: unknown, name: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) throw new Error(`${name} is invalid`)
  const items = value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 300 || /[\u0000-\u001f\u007f]/.test(item)) {
      throw new Error(`${name} is invalid`)
    }
    return item.trim()
  })
  return [...new Set(items)].sort()
}

function positiveLimit(value: unknown, name: string, maximum: number): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`${name} is invalid`)
  return result
}

function limits(value: BoundedWriteLimits): BoundedWriteLimits {
  return {
    max_operations: positiveLimit(value?.max_operations, 'max_operations', 1_000),
    max_changed_files: positiveLimit(value?.max_changed_files, 'max_changed_files', 300),
    max_total_changed_bytes: positiveLimit(value?.max_total_changed_bytes, 'max_total_changed_bytes', 10_000_000),
    max_commits: positiveLimit(value?.max_commits, 'max_commits', 20),
    max_pushes: positiveLimit(value?.max_pushes, 'max_pushes', 20),
    max_pull_requests: positiveLimit(value?.max_pull_requests, 'max_pull_requests', 1),
  }
}

function ttlSeconds(value: unknown): number {
  if (value === undefined) return DEFAULT_BOUNDED_WRITE_TTL_SECONDS
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < MIN_BOUNDED_WRITE_TTL_SECONDS || result > MAX_BOUNDED_WRITE_TTL_SECONDS) {
    throw new Error(`expires_in_seconds must be between ${MIN_BOUNDED_WRITE_TTL_SECONDS} and ${MAX_BOUNDED_WRITE_TTL_SECONDS}`)
  }
  return result
}

function randomSecret(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function storeRequest(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const response = await storeStub(env).fetch(`https://security-audit-store${path}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  })
  const payload = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Bounded write credential store error ${response.status}`)
  return payload
}

export async function boundedWriteScopeHash(
  record: Parameters<typeof boundedWriteScopePayload>[0],
): Promise<string> {
  return sha256Hex(JSON.stringify(boundedWriteScopePayload(record)))
}

export async function boundedWriteCredentialCreate(
  env: Env,
  input: IssueBoundedWriteCredentialInput,
  now = new Date().toISOString(),
): Promise<IssuedBoundedWriteCredential> {
  const projectId = identifier(input.project_id, 'project_id', 64)
  getProject(env, projectId)
  const ttl = ttlSeconds(input.expires_in_seconds)
  const issuedAt = new Date(now).toISOString()
  const credentialId = crypto.randomUUID()
  const rawSecret = `${BOUNDED_WRITE_CREDENTIAL_PREFIX}.${credentialId}.${randomSecret()}`
  const scope = {
    schema_version: BOUNDED_WRITE_CREDENTIAL_SCHEMA_VERSION,
    credential_version: BOUNDED_WRITE_CREDENTIAL_VERSION,
    credential_id: credentialId,
    project_id: projectId,
    mission_id: identifier(input.mission_id, 'mission_id'),
    execution_plan_id: identifier(input.execution_plan_id, 'execution_plan_id'),
    task_id: identifier(input.task_id, 'task_id'),
    attempt_id: identifier(input.attempt_id, 'attempt_id'),
    lease_id: identifier(input.lease_id, 'lease_id'),
    fencing_token: positiveLimit(input.fencing_token, 'fencing_token', Number.MAX_SAFE_INTEGER),
    agent_id: identifier(input.agent_id, 'agent_id'),
    provider: identifier(input.provider, 'provider', 80),
    profile: BOUNDED_WRITE_PROFILE,
    branch: identifier(input.branch, 'branch'),
    base_sha: sha(input.base_sha, 'base_sha'),
    allowed_tools: stringList(input.allowed_tools, 'allowed_tools'),
    allowed_paths: stringList(input.allowed_paths, 'allowed_paths'),
    denied_paths: [...new Set([
      ...DEFAULT_BOUNDED_WRITE_DENIED_PATHS,
      ...(input.denied_paths ?? []),
    ])].sort(),
    safety_class: 'repository-bounded-write' as const,
    limits: limits(input.limits),
    idempotency_namespace: identifier(input.idempotency_namespace, 'idempotency_namespace'),
    approval_record_id: identifier(input.approval_record_id, 'approval_record_id'),
  }
  const record: BoundedWriteCredentialRecord = {
    ...scope,
    issued_at: issuedAt,
    expires_at: new Date(Date.parse(issuedAt) + ttl * 1000).toISOString(),
    usage: { ...EMPTY_BOUNDED_WRITE_USAGE },
    scope_hash: await boundedWriteScopeHash(scope),
    secret_hash: await sha256Hex(rawSecret),
  }
  const payload = await storeRequest(env, '/bounded-write-credentials', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  return { credential: payload.credential as PublicBoundedWriteCredential, secret: rawSecret }
}

export async function boundedWriteCredentialGet(env: Env, credentialId: string): Promise<PublicBoundedWriteCredential> {
  const payload = await storeRequest(env, `/bounded-write-credentials/${encodeURIComponent(identifier(credentialId, 'credential_id', 64))}`)
  return payload.credential as PublicBoundedWriteCredential
}

export async function boundedWriteCredentialRevoke(env: Env, credentialId: string): Promise<PublicBoundedWriteCredential> {
  const payload = await storeRequest(env, `/bounded-write-credentials/${encodeURIComponent(identifier(credentialId, 'credential_id', 64))}/revoke`, {
    method: 'POST',
  })
  return payload.credential as PublicBoundedWriteCredential
}
