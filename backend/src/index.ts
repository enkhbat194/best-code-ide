import { handleActions } from './actions'
import { handleApprovals } from './approvals'
import { handleAssetBinaryApi } from './assetBinaryApi'
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
  rateLimitForIdentity,
  requestLimitFor,
} from './security'
import { handleSecurityAudit, persistSecurityAudit } from './securityAudit'
import { handleTasks } from './tasks'
import { handleWorkspaceExport } from './workspace'
import { CORS_HEADERS, jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

export { ApprovalStore } from './approvalStore'
export { BrainStore } from './brainStore'
export { SecurityAuditStore } from './securityAuditStore'

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function isAuthorized(req: Request, env: Env): Promise<boolean> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (new URL(req.url).searchParams.get('key') ?? '')
  const expected = resolveSecret(env, 'AUTH_TOKEN')
  if (!token || !expected) return false

  const [actualHash, expectedHash] = await Promise.all([digest(token), digest(expected)])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index += 1) difference |= actualHash[index] ^ expectedHash[index]
  return difference === 0
}

function disabledExplicitly(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'false'
}

function unauthorized(): Response {
  const response = jsonError('Unauthorized — missing or invalid Bearer token', 401)
  response.headers.set('WWW-Authenticate', 'Bearer realm="BestCode MCP"')
  response.headers.set('Cache-Control', 'no-store')
  return response
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

    const authorized = await isAuthorized(req, env)
    const rateProfile = {
      owner: parsePositiveInteger(resolveSecret(env, 'OWNER_RATE_LIMIT_REQUESTS'), DEFAULT_OWNER_RATE_LIMIT),
      unauthorized: parsePositiveInteger(resolveSecret(env, 'UNAUTHORIZED_RATE_LIMIT_REQUESTS'), DEFAULT_UNAUTHORIZED_RATE_LIMIT),
      fallback: parsePositiveInteger(resolveSecret(env, 'RATE_LIMIT_REQUESTS'), DEFAULT_RATE_LIMIT),
      windowMs: parsePositiveInteger(resolveSecret(env, 'RATE_LIMIT_WINDOW_MS'), DEFAULT_RATE_WINDOW_MS),
    }
    const identity = authorized ? 'owner' : 'unauthorized'
    const rateResponse = enforceRateLimit(`${identity}:${clientRateKey(req)}`, rateLimitForIdentity(authorized, rateProfile), rateProfile.windowMs)
    if (rateResponse) {
      audit('rate_limit_rejected', { path: url.pathname, method: req.method, identity, client: clientRateKey(req) })
      return rateResponse
    }

    if (!authorized) {
      audit('authorization_rejected', { path: url.pathname, method: req.method, identity, client: clientRateKey(req) })
      return unauthorized()
    }

    const securityAuditResponse = await handleSecurityAudit(req, env, url)
    if (securityAuditResponse) return securityAuditResponse

    const assetBinaryResponse = await handleAssetBinaryApi(req, env, url)
    if (assetBinaryResponse) {
      audit('asset_binary_api', { path: url.pathname, method: req.method, status: assetBinaryResponse.status, identity })
      return assetBinaryResponse
    }

    const brainResponse = await handleBrainApi(req, env, url)
    if (brainResponse) {
      audit('brain_api', { path: url.pathname, method: req.method, status: brainResponse.status, identity })
      return brainResponse
    }

    const missionResponse = await handleMissionApi(req, env, url)
    if (missionResponse) {
      audit('mission_api', { path: url.pathname, method: req.method, status: missionResponse.status, identity })
      return missionResponse
    }

    if (url.pathname === '/mcp' && (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')) return handleMcp(req, env)

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
