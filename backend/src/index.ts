import { handleActions } from './actions'
import { handleApprovals } from './approvals'
import { handleAssetBinaryApi } from './assetBinaryApi'
import { handleAssetProcessingApi } from './assetProcessingApi'
import { authenticateRequest, isAuthorized } from './authentication'
import { handleBrainApi } from './brainApi'
import { handleChat } from './chat'
import { handleFilesCommit } from './files'
import { handleLlm } from './llm'
import { handleMaintenance } from './maintenance'
import { handleMcp } from './mcp'
import { handleMissionApi } from './missionApi'
import { openapiSpec } from './openapi'
import { handleRelease, healthPayload } from './release'
import { handleRest } from './rest'
import {
  DEFAULT_ASSET_REQUEST_BYTES,
  DEFAULT_CHAT_REQUEST_BYTES,
  DEFAULT_FILE_REQUEST_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_OWNER_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
  DEFAULT_UNAUTHORIZED_RATE_LIMIT,
  DEFAULT_WORKSPACE_REQUEST_BYTES,
  clientRateKey,
  enforceRateLimit,
  enforceRequestLimits,
  isOriginAllowed,
  parseAllowedOrigins,
  parsePositiveInteger,
  requestLimitFor,
} from './security'
import { handleSecurityAudit, persistSecurityAudit } from './securityAudit'
import { handleSubscriptionCredentialApi } from './subscriptionCredentialApi'
import type { RequestPrincipal } from './subscriptionCredentialTypes'
import { handleTasks } from './tasks'
import { handleWorkspaceExport } from './workspace'
import { CORS_HEADERS, jsonError, jsonResponse, resolveSecret, withCors } from './utils'
import type { Env } from './types'

export { ApprovalStore } from './approvalStore'
export { BrainStore } from './brainStore'
export { SecurityAuditStore } from './securityAuditStore'
export { isAuthorized }

function disabledExplicitly(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'false'
}

function unauthorized(): Response {
  const response = jsonError('Unauthorized — missing or invalid Bearer token', 401)
  response.headers.set('WWW-Authenticate', 'Bearer realm="BestCode MCP"')
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function rateLimitIdentity(principal: RequestPrincipal | null): string {
  if (!principal) return 'unauthorized'
  return principal.kind === 'owner' ? 'owner' : `subscription:${principal.credential_id}`
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const audit = (event: string, details: Record<string, unknown>) => {
      ctx.waitUntil(persistSecurityAudit(env, event, details).catch((error) => {
        console.error('Security audit persistence failed', error instanceof Error ? error.message : String(error))
      }))
    }

    const origin = req.headers.get('Origin')
    const allowedOrigins = parseAllowedOrigins(resolveSecret(env, 'CORS_ALLOWED_ORIGINS'))
    if (!isOriginAllowed(origin, allowedOrigins)) {
      audit('origin_rejected', { origin, path: url.pathname, method: req.method, identity: 'unknown' })
      return jsonError('Origin is not allowed', 403)
    }

    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

    const requestLimit = requestLimitFor(url, {
      defaultBytes: parsePositiveInteger(resolveSecret(env, 'MAX_REQUEST_BYTES'), DEFAULT_MAX_REQUEST_BYTES),
      chatBytes: parsePositiveInteger(resolveSecret(env, 'MAX_CHAT_REQUEST_BYTES'), DEFAULT_CHAT_REQUEST_BYTES),
      fileBytes: parsePositiveInteger(resolveSecret(env, 'MAX_FILE_REQUEST_BYTES'), DEFAULT_FILE_REQUEST_BYTES),
      workspaceBytes: parsePositiveInteger(resolveSecret(env, 'MAX_WORKSPACE_REQUEST_BYTES'), DEFAULT_WORKSPACE_REQUEST_BYTES),
      assetBytes: parsePositiveInteger(resolveSecret(env, 'MAX_ASSET_BYTES'), DEFAULT_ASSET_REQUEST_BYTES),
    })
    const limitResponse = enforceRequestLimits(req, requestLimit)
    if (limitResponse) {
      audit('request_size_rejected', { path: url.pathname, method: req.method, requestLimit, identity: 'unknown' })
      return limitResponse
    }

    if (url.pathname === '/health') {
      const response = jsonResponse(healthPayload(env))
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    if (url.pathname === '/openapi.json' && req.method === 'GET') return jsonResponse(openapiSpec(url.origin))

    const authentication = await authenticateRequest(req, env)
    const principal = authentication.principal
    const rateProfile = {
      owner: parsePositiveInteger(resolveSecret(env, 'OWNER_RATE_LIMIT_REQUESTS'), DEFAULT_OWNER_RATE_LIMIT),
      unauthorized: parsePositiveInteger(resolveSecret(env, 'UNAUTHORIZED_RATE_LIMIT_REQUESTS'), DEFAULT_UNAUTHORIZED_RATE_LIMIT),
      fallback: parsePositiveInteger(resolveSecret(env, 'RATE_LIMIT_REQUESTS'), DEFAULT_RATE_LIMIT),
      windowMs: parsePositiveInteger(resolveSecret(env, 'RATE_LIMIT_WINDOW_MS'), DEFAULT_RATE_WINDOW_MS),
    }
    const identity = rateLimitIdentity(principal)
    const rateLimit = principal?.kind === 'owner'
      ? rateProfile.owner
      : principal?.kind === 'subscription'
        ? rateProfile.fallback
        : rateProfile.unauthorized
    const rateResponse = enforceRateLimit(`${identity}:${clientRateKey(req)}`, rateLimit, rateProfile.windowMs)
    if (rateResponse) {
      audit('rate_limit_rejected', {
        path: url.pathname,
        method: req.method,
        identity: principal?.kind === 'owner' ? 'owner' : principal ? 'unknown' : 'unauthorized',
        auth_type: principal?.kind ?? authentication.attempted_kind,
        credential_id: principal?.kind === 'subscription' ? principal.credential_id : undefined,
        client: clientRateKey(req),
      })
      return rateResponse
    }

    if (!principal) {
      audit('authorization_rejected', {
        path: url.pathname,
        method: req.method,
        identity: 'unauthorized',
        attempted_kind: authentication.attempted_kind,
        denial_code: authentication.denial_code,
        client: clientRateKey(req),
      })
      return unauthorized()
    }

    if (
      (url.pathname === '/mcp' || url.pathname === '/mcp/subscription') &&
      (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')
    ) {
      return handleMcp(req, env, principal)
    }

    if (principal.kind !== 'owner') {
      audit('scoped_endpoint_denied', {
        path: url.pathname,
        method: req.method,
        identity: 'unknown',
        auth_type: 'subscription',
        credential_id: principal.credential_id,
        project_id: principal.project_id,
        denial_code: 'ENDPOINT_NOT_ALLOWED',
      })
      return unauthorized()
    }

    const credentialResponse = await handleSubscriptionCredentialApi(req, env, url, principal)
    if (credentialResponse) return credentialResponse

    const securityAuditResponse = await handleSecurityAudit(req, env, url)
    if (securityAuditResponse) return securityAuditResponse

    const assetProcessingResponse = await handleAssetProcessingApi(req, env, url)
    if (assetProcessingResponse) {
      audit('asset_processing_api', { path: url.pathname, method: req.method, status: assetProcessingResponse.status, identity: 'owner' })
      return withCors(assetProcessingResponse)
    }

    const assetBinaryResponse = await handleAssetBinaryApi(req, env, url)
    if (assetBinaryResponse) {
      audit('asset_binary_api', { path: url.pathname, method: req.method, status: assetBinaryResponse.status, identity: 'owner' })
      return withCors(assetBinaryResponse)
    }

    const brainResponse = await handleBrainApi(req, env, url)
    if (brainResponse) {
      audit('brain_api', { path: url.pathname, method: req.method, status: brainResponse.status, identity: 'owner' })
      return withCors(brainResponse)
    }

    const missionResponse = await handleMissionApi(req, env, url)
    if (missionResponse) {
      audit('mission_api', { path: url.pathname, method: req.method, status: missionResponse.status, identity: 'owner' })
      return missionResponse
    }

    const actionResponse = await handleActions(req, env, url)
    if (actionResponse) return actionResponse

    const approvalResponse = await handleApprovals(req, env, url)
    if (approvalResponse) return approvalResponse

    const maintenanceResponse = await handleMaintenance(req, env, url)
    if (maintenanceResponse) return maintenanceResponse

    const taskResponse = await handleTasks(req, env, url)
    if (taskResponse) return taskResponse

    const releaseResponse = await handleRelease(req, env, url)
    if (releaseResponse) return releaseResponse

    if (url.pathname === '/api/llm' && req.method === 'POST') return handleLlm(req, env)

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      if (disabledExplicitly(env.ENABLE_LEGACY_AGENT)) return jsonError('In-app AI agent is disabled by configuration (ENABLE_LEGACY_AGENT=false).', 410)
      return handleChat(req, env)
    }

    if (url.pathname === '/api/files/commit' && req.method === 'POST') return handleFilesCommit(req, env)
    if (url.pathname === '/api/workspace/export' && req.method === 'POST') return handleWorkspaceExport(req, env)

    const restResponse = await handleRest(req, env, url)
    if (restResponse) return restResponse

    return jsonError('Not found', 404)
  },
}
