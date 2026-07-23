import { getProject } from './projects'
import { subscriptionToolNames } from './subscriptionTools'
import type { Env } from './types'
import {
  DEFAULT_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS,
  MAX_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS,
  MIN_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS,
  SUBSCRIPTION_CREDENTIAL_PREFIX,
  SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION,
  SUBSCRIPTION_CREDENTIAL_VERSION,
  SUBSCRIPTION_PROFILE,
  SUBSCRIPTION_TOOL_SET_VERSION,
  type PublicSubscriptionCredential,
  type SubscriptionCredentialRecord,
  type SubscriptionPrincipal,
} from './subscriptionCredentialTypes'

export const subscriptionCredentialOwnerOperationNames = [
  'subscription_credential_create',
  'subscription_credential_list',
  'subscription_credential_get',
  'subscription_credential_revoke',
] as const

export interface IssueSubscriptionCredentialInput {
  project_id: string
  agent_id: string
  provider: string
  expires_in_seconds?: number
  note?: string
  created_request_id?: string
}

export interface IssuedSubscriptionCredential {
  credential: PublicSubscriptionCredential
  secret: string
}

function storeStub(env: Env): DurableObjectStub {
  if (!env.SECURITY_AUDIT) throw new Error('Subscription credential storage is not configured')
  return env.SECURITY_AUDIT.get(env.SECURITY_AUDIT.idFromName('bestcode-security-audit-v1'))
}

function cleanIdentifier(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  const result = value.trim().slice(0, max)
  if (!/^[A-Za-z0-9._:@/-]+$/.test(result)) throw new Error(`${name} contains unsupported characters`)
  return result
}

function cleanNote(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('note must be a string')
  const result = value.trim().slice(0, 500)
  return result || undefined
}

function ttlSeconds(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error('expires_in_seconds must be an integer')
  if (parsed < MIN_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS || parsed > MAX_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS) {
    throw new Error(`expires_in_seconds must be between ${MIN_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS} and ${MAX_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS}`)
  }
  return parsed
}

function randomSecret(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function credentialToken(credentialId: string, secret: string): string {
  return `${SUBSCRIPTION_CREDENTIAL_PREFIX}.${credentialId}.${secret}`
}

export function looksLikeScopedCredential(value: string): boolean {
  return value.startsWith('bcsub_')
}

export function parseScopedCredential(value: string): { credential_id: string } | null {
  const match = value.match(/^bcsub_v1\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{32,128})$/i)
  return match ? { credential_id: match[1].toLowerCase() } : null
}

async function storeRequest(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const response = await storeStub(env).fetch(`https://security-audit-store${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string' ? payload.error : `Subscription credential store error ${response.status}`
    throw new Error(message)
  }
  return payload
}

export async function subscriptionCredentialCreate(
  env: Env,
  input: IssueSubscriptionCredentialInput,
  now = new Date().toISOString(),
): Promise<IssuedSubscriptionCredential> {
  const projectId = cleanIdentifier(input.project_id, 'project_id', 64)
  getProject(env, projectId)
  const agentId = cleanIdentifier(input.agent_id, 'agent_id', 160)
  const provider = cleanIdentifier(input.provider, 'provider', 80)
  const ttl = ttlSeconds(input.expires_in_seconds)
  const issuedAt = new Date(now).toISOString()
  const expiresAt = new Date(Date.parse(issuedAt) + ttl * 1000).toISOString()
  const credentialId = crypto.randomUUID()
  const secret = credentialToken(credentialId, randomSecret())
  const note = cleanNote(input.note)
  const record: SubscriptionCredentialRecord = {
    schema_version: SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION,
    credential_id: credentialId,
    project_id: projectId,
    subject_agent_id: agentId,
    agent_provider: provider,
    allowed_mcp_profile: SUBSCRIPTION_PROFILE,
    allowed_tools: [...subscriptionToolNames],
    tool_set_version: SUBSCRIPTION_TOOL_SET_VERSION,
    issued_at: issuedAt,
    expires_at: expiresAt,
    created_by_owner_identity: 'owner',
    request_count: 0,
    credential_version: SUBSCRIPTION_CREDENTIAL_VERSION,
    ...(note ? { note } : {}),
    audit_metadata: {
      rate_limit_policy: 'subscription-default-v1',
      ...(input.created_request_id ? { created_request_id: cleanIdentifier(input.created_request_id, 'created_request_id', 128) } : {}),
    },
    secret_hash: await sha256Hex(secret),
  }
  const payload = await storeRequest(env, '/subscription-credentials', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  return { credential: payload.credential as PublicSubscriptionCredential, secret }
}

export async function subscriptionCredentialList(env: Env, projectId?: string): Promise<PublicSubscriptionCredential[]> {
  const query = new URLSearchParams()
  if (projectId) {
    const cleanProjectId = cleanIdentifier(projectId, 'project_id', 64)
    getProject(env, cleanProjectId)
    query.set('project_id', cleanProjectId)
  }
  const payload = await storeRequest(env, `/subscription-credentials${query.size ? `?${query.toString()}` : ''}`)
  return Array.isArray(payload.items) ? payload.items as PublicSubscriptionCredential[] : []
}

export async function subscriptionCredentialGet(env: Env, credentialId: string): Promise<PublicSubscriptionCredential> {
  const id = cleanIdentifier(credentialId, 'credential_id', 64)
  const payload = await storeRequest(env, `/subscription-credentials/${encodeURIComponent(id)}`)
  return payload.credential as PublicSubscriptionCredential
}

export async function subscriptionCredentialRevoke(
  env: Env,
  credentialId: string,
  now = new Date().toISOString(),
): Promise<PublicSubscriptionCredential> {
  const id = cleanIdentifier(credentialId, 'credential_id', 64)
  const payload = await storeRequest(env, `/subscription-credentials/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ revoked_at: new Date(now).toISOString() }),
  })
  return payload.credential as PublicSubscriptionCredential
}

export async function authenticateScopedCredential(
  env: Env,
  rawCredential: string,
  options: {
    endpoint: string
    project_id: string
    profile?: string
    now?: string
  },
): Promise<SubscriptionPrincipal | null> {
  const parsed = parseScopedCredential(rawCredential)
  const credentialId = parsed?.credential_id ?? '00000000-0000-0000-0000-000000000000'
  const presentedHash = await sha256Hex(rawCredential)
  const response = await storeStub(env).fetch('https://security-audit-store/subscription-credentials/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential_id: credentialId,
      presented_hash: presentedHash,
      endpoint: options.endpoint,
      project_id: options.project_id,
      profile: options.profile ?? SUBSCRIPTION_PROFILE,
      ...(options.now ? { now: new Date(options.now).toISOString() } : {}),
    }),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; principal?: Omit<SubscriptionPrincipal, 'kind'> } | null
  return response.ok && payload?.ok === true && payload.principal ? { kind: 'subscription', ...payload.principal } : null
}
