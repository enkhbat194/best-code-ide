export const SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION = 'bestcode-subscription-credential-v1' as const
export const SUBSCRIPTION_CREDENTIAL_PREFIX = 'bcsub_v1' as const
export const SUBSCRIPTION_PROFILE = 'subscription-readonly' as const
export const SUBSCRIPTION_TOOL_SET_VERSION = 'subscription-readonly-v1' as const
export const SUBSCRIPTION_CREDENTIAL_VERSION = 1 as const
export const DEFAULT_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS = 86_400
export const MIN_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS = 300
export const MAX_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS = 2_592_000

export type SubscriptionCredentialStatus = 'active' | 'expired' | 'revoked' | 'disabled'

export interface SubscriptionCredentialRecord {
  schema_version: typeof SUBSCRIPTION_CREDENTIAL_SCHEMA_VERSION
  credential_id: string
  project_id: string
  subject_agent_id: string
  agent_provider: string
  allowed_mcp_profile: typeof SUBSCRIPTION_PROFILE
  allowed_tools: string[]
  tool_set_version: typeof SUBSCRIPTION_TOOL_SET_VERSION
  issued_at: string
  expires_at: string
  revoked_at?: string
  disabled_at?: string
  created_by_owner_identity: string
  last_used_at?: string
  request_count: number
  credential_version: typeof SUBSCRIPTION_CREDENTIAL_VERSION
  note?: string
  audit_metadata: {
    rate_limit_policy: string
    created_request_id?: string
    [key: string]: unknown
  }
  secret_hash: string
}

export type PublicSubscriptionCredential = Omit<SubscriptionCredentialRecord, 'secret_hash'> & {
  status: SubscriptionCredentialStatus
}

export interface OwnerPrincipal {
  kind: 'owner'
  identity: 'owner'
}

export interface SubscriptionPrincipal {
  kind: 'subscription'
  credential_id: string
  project_id: string
  agent_id: string
  provider: string
  profile: typeof SUBSCRIPTION_PROFILE
  tool_set_version: typeof SUBSCRIPTION_TOOL_SET_VERSION
  allowed_tools: string[]
  credential_version: typeof SUBSCRIPTION_CREDENTIAL_VERSION
  issued_at: string
  expires_at: string
}

import type { BoundedWritePrincipal } from './boundedWriteCredentialTypes'

export type RequestPrincipal = OwnerPrincipal | SubscriptionPrincipal | BoundedWritePrincipal

export interface AuthenticationResult {
  principal: RequestPrincipal | null
  attempted_kind: 'owner' | 'subscription' | 'bounded-write' | 'none'
  denial_code?: 'AUTHENTICATION_REQUIRED' | 'INVALID_OWNER_CREDENTIAL' | 'INVALID_SCOPED_CREDENTIAL' | 'INVALID_BOUNDED_WRITE_CREDENTIAL'
}
