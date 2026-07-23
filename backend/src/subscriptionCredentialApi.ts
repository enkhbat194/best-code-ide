import { persistSecurityAudit } from './securityAudit'
import {
  subscriptionCredentialCreate,
  subscriptionCredentialGet,
  subscriptionCredentialList,
  subscriptionCredentialRevoke,
} from './subscriptionCredentials'
import type { RequestPrincipal } from './subscriptionCredentialTypes'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function ownerOnly(principal: RequestPrincipal): Response | null {
  return principal.kind === 'owner' ? null : noStore(jsonError('Unauthorized', 401))
}

function requestId(req: Request): string | undefined {
  const value = req.headers.get('X-BestCode-Request-Id')?.trim()
  return value && /^[A-Za-z0-9._:@/-]{1,128}$/.test(value) ? value : undefined
}

export async function handleSubscriptionCredentialApi(
  req: Request,
  env: Env,
  url: URL,
  principal: RequestPrincipal,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/subscription/credentials')) return null
  const denied = ownerOnly(principal)
  if (denied) return denied

  try {
    if (url.pathname === '/api/subscription/credentials') {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => null)
        if (!body || typeof body !== 'object' || Array.isArray(body)) return noStore(jsonError('Invalid JSON body', 400))
        const input = body as Record<string, unknown>
        const issued = await subscriptionCredentialCreate(env, {
          project_id: typeof input.project_id === 'string' ? input.project_id : '',
          agent_id: typeof input.agent_id === 'string'
            ? input.agent_id
            : (typeof input.agent_name === 'string' ? input.agent_name : ''),
          provider: typeof input.provider === 'string' ? input.provider : 'provider-neutral',
          ...(input.expires_in_seconds === undefined ? {} : { expires_in_seconds: Number(input.expires_in_seconds) }),
          ...(typeof input.note === 'string' ? { note: input.note } : {}),
          ...(requestId(req) ? { created_request_id: requestId(req) } : {}),
        })
        await persistSecurityAudit(env, 'subscription_credential_created', {
          path: url.pathname,
          method: req.method,
          identity: 'owner',
          credential_id: issued.credential.credential_id,
          project_id: issued.credential.project_id,
          agent_id: issued.credential.subject_agent_id,
          provider: issued.credential.agent_provider,
          expires_at: issued.credential.expires_at,
          credential_version: issued.credential.credential_version,
        })
        return noStore(jsonResponse({
          credential: issued.credential,
          secret: issued.secret,
          secret_display: 'one-time',
        }, 201))
      }

      if (req.method === 'GET') {
        const items = await subscriptionCredentialList(env, url.searchParams.get('project_id') ?? undefined)
        return noStore(jsonResponse({ items, count: items.length }))
      }

      return noStore(jsonError('Method not allowed', 405))
    }

    const match = url.pathname.match(/^\/api\/subscription\/credentials\/([a-f0-9-]{36})(?:\/(revoke))?$/i)
    if (!match) return noStore(jsonError('Not found', 404))
    const credentialId = match[1]
    const operation = match[2]

    if (!operation && req.method === 'GET') {
      const credential = await subscriptionCredentialGet(env, credentialId)
      return noStore(jsonResponse({ credential }))
    }

    if (operation === 'revoke' && req.method === 'POST') {
      const credential = await subscriptionCredentialRevoke(env, credentialId)
      await persistSecurityAudit(env, 'subscription_credential_revoked', {
        path: url.pathname,
        method: req.method,
        identity: 'owner',
        credential_id: credential.credential_id,
        project_id: credential.project_id,
        agent_id: credential.subject_agent_id,
        provider: credential.agent_provider,
        revoked_at: credential.revoked_at,
        credential_version: credential.credential_version,
      })
      return noStore(jsonResponse({ credential }))
    }

    return noStore(jsonError('Method not allowed', 405))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /not found/i.test(message) ? 404 : /required|must be|unsupported|invalid|between/i.test(message) ? 400 : 503
    return noStore(jsonError(message, status))
  }
}
