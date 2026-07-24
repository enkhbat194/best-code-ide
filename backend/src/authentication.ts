import { authenticateScopedCredential, looksLikeScopedCredential } from './subscriptionCredentials'
import {
  authenticateBoundedWriteCredential,
  looksLikeBoundedWriteCredential,
} from './boundedWriteCredentials'
import { SUBSCRIPTION_PROFILE, type AuthenticationResult } from './subscriptionCredentialTypes'
import type { Env } from './types'
import { resolveSecret } from './utils'

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function constantTimeSecretEqual(actual: string, expected: string): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([digest(actual), digest(expected)])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index += 1) difference |= actualHash[index] ^ expectedHash[index]
  return difference === 0
}

function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function ownerQueryKey(req: Request): string {
  return new URL(req.url).searchParams.get('key')?.trim() ?? ''
}

export async function isAuthorized(req: Request, env: Pick<Env, 'AUTH_TOKEN'>): Promise<boolean> {
  const bearer = bearerToken(req)
  const candidate = bearer || ownerQueryKey(req)
  const expected = resolveSecret(env, 'AUTH_TOKEN')
  if (!candidate || !expected || looksLikeScopedCredential(candidate) || looksLikeBoundedWriteCredential(candidate)) return false
  return constantTimeSecretEqual(candidate, expected)
}

export async function authenticateRequest(req: Request, env: Env, now?: string): Promise<AuthenticationResult> {
  const url = new URL(req.url)
  const bearer = bearerToken(req)
  const queryKey = ownerQueryKey(req)

  if (bearer && looksLikeBoundedWriteCredential(bearer)) {
    const principal = await authenticateBoundedWriteCredential(env, bearer, {
      endpoint: url.pathname,
      project_id: url.searchParams.get('project_id') ?? '',
      ...(now ? { now } : {}),
    })
    return principal
      ? { principal, attempted_kind: 'bounded-write' }
      : { principal: null, attempted_kind: 'bounded-write', denial_code: 'INVALID_BOUNDED_WRITE_CREDENTIAL' }
  }

  if (bearer && looksLikeScopedCredential(bearer)) {
    const principal = await authenticateScopedCredential(env, bearer, {
      endpoint: url.pathname,
      project_id: url.searchParams.get('project_id') ?? '',
      profile: SUBSCRIPTION_PROFILE,
      ...(now ? { now } : {}),
    })
    return principal
      ? { principal, attempted_kind: 'subscription' }
      : { principal: null, attempted_kind: 'subscription', denial_code: 'INVALID_SCOPED_CREDENTIAL' }
  }

  if (queryKey && (looksLikeScopedCredential(queryKey) || looksLikeBoundedWriteCredential(queryKey))) {
    return looksLikeBoundedWriteCredential(queryKey)
      ? { principal: null, attempted_kind: 'bounded-write', denial_code: 'INVALID_BOUNDED_WRITE_CREDENTIAL' }
      : { principal: null, attempted_kind: 'subscription', denial_code: 'INVALID_SCOPED_CREDENTIAL' }
  }

  const candidate = bearer || queryKey
  if (!candidate) return { principal: null, attempted_kind: 'none', denial_code: 'AUTHENTICATION_REQUIRED' }

  const expected = resolveSecret(env, 'AUTH_TOKEN')
  if (expected && await constantTimeSecretEqual(candidate, expected)) {
    return { principal: { kind: 'owner', identity: 'owner' }, attempted_kind: 'owner' }
  }

  return { principal: null, attempted_kind: 'owner', denial_code: 'INVALID_OWNER_CREDENTIAL' }
}
