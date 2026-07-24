export const BOUNDED_WRITE_CREDENTIAL_SCHEMA_VERSION = 'bestcode-bounded-write-credential-v1' as const
export const BOUNDED_WRITE_CREDENTIAL_PREFIX = 'bcwrite_v1' as const
export const BOUNDED_WRITE_PROFILE = 'subscription-write-bounded-v1' as const
export const BOUNDED_WRITE_CREDENTIAL_VERSION = 1 as const
export const DEFAULT_BOUNDED_WRITE_TTL_SECONDS = 1_800
export const MIN_BOUNDED_WRITE_TTL_SECONDS = 300
export const MAX_BOUNDED_WRITE_TTL_SECONDS = 7_200

export type BoundedWriteSafetyClass = 'repository-bounded-write'
export type BoundedWriteCredentialStatus = 'active' | 'expired' | 'revoked'

export interface BoundedWriteLimits {
  max_operations: number
  max_changed_files: number
  max_total_changed_bytes: number
  max_commits: number
  max_pushes: number
  max_pull_requests: number
}

export interface BoundedWriteUsage {
  operations: number
  changed_files: number
  total_changed_bytes: number
  commits: number
  pushes: number
  pull_requests: number
}

export interface BoundedWriteCredentialRecord {
  schema_version: typeof BOUNDED_WRITE_CREDENTIAL_SCHEMA_VERSION
  credential_version: typeof BOUNDED_WRITE_CREDENTIAL_VERSION
  credential_id: string
  project_id: string
  mission_id: string
  execution_plan_id: string
  task_id: string
  attempt_id: string
  lease_id: string
  fencing_token: number
  agent_id: string
  provider: string
  profile: typeof BOUNDED_WRITE_PROFILE
  branch: string
  base_sha: string
  allowed_tools: string[]
  allowed_paths: string[]
  denied_paths: string[]
  safety_class: BoundedWriteSafetyClass
  issued_at: string
  expires_at: string
  revoked_at?: string
  limits: BoundedWriteLimits
  usage: BoundedWriteUsage
  idempotency_namespace: string
  approval_record_id: string
  scope_hash: string
  secret_hash: string
}

export type PublicBoundedWriteCredential = Omit<BoundedWriteCredentialRecord, 'secret_hash'> & {
  status: BoundedWriteCredentialStatus
}

export interface BoundedWritePrincipal {
  kind: 'bounded-write'
  credential_id: string
  project_id: string
  mission_id: string
  execution_plan_id: string
  task_id: string
  attempt_id: string
  lease_id: string
  fencing_token: number
  agent_id: string
  provider: string
  profile: typeof BOUNDED_WRITE_PROFILE
  branch: string
  base_sha: string
  allowed_tools: string[]
  allowed_paths: string[]
  denied_paths: string[]
  safety_class: BoundedWriteSafetyClass
  expires_at: string
  limits: BoundedWriteLimits
  usage: BoundedWriteUsage
  idempotency_namespace: string
  approval_record_id: string
  scope_hash: string
}

export const EMPTY_BOUNDED_WRITE_USAGE: Readonly<BoundedWriteUsage> = Object.freeze({
  operations: 0,
  changed_files: 0,
  total_changed_bytes: 0,
  commits: 0,
  pushes: 0,
  pull_requests: 0,
})

export const DEFAULT_BOUNDED_WRITE_DENIED_PATHS = Object.freeze([
  '.github/workflows/**',
  '.env',
  '.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/wrangler.toml',
  '**/migrations/**',
  '**/credentials/**',
  '**/secrets/**',
] as const)

export function boundedWriteCredentialStatus(
  record: Pick<BoundedWriteCredentialRecord, 'expires_at' | 'revoked_at'>,
  now = new Date().toISOString(),
): BoundedWriteCredentialStatus {
  if (record.revoked_at) return 'revoked'
  return Date.parse(now) >= Date.parse(record.expires_at) ? 'expired' : 'active'
}

export function publicBoundedWriteCredential(
  record: BoundedWriteCredentialRecord,
  now = new Date().toISOString(),
): PublicBoundedWriteCredential {
  const { secret_hash: _secretHash, ...safe } = record
  return { ...safe, status: boundedWriteCredentialStatus(record, now) }
}

export function boundedWriteScopePayload(
  record: Omit<BoundedWriteCredentialRecord, 'scope_hash' | 'secret_hash' | 'usage' | 'issued_at' | 'expires_at' | 'revoked_at'>,
): Record<string, unknown> {
  return {
    schema_version: record.schema_version,
    credential_version: record.credential_version,
    credential_id: record.credential_id,
    project_id: record.project_id,
    mission_id: record.mission_id,
    execution_plan_id: record.execution_plan_id,
    task_id: record.task_id,
    attempt_id: record.attempt_id,
    lease_id: record.lease_id,
    fencing_token: record.fencing_token,
    agent_id: record.agent_id,
    provider: record.provider,
    profile: record.profile,
    branch: record.branch,
    base_sha: record.base_sha,
    allowed_tools: [...record.allowed_tools].sort(),
    allowed_paths: [...record.allowed_paths].sort(),
    denied_paths: [...record.denied_paths].sort(),
    safety_class: record.safety_class,
    limits: record.limits,
    idempotency_namespace: record.idempotency_namespace,
    approval_record_id: record.approval_record_id,
  }
}
