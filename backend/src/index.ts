import { handleActions } from './actions'
import { handleApprovals } from './approvals'
import { handleChat } from './chat'
import { handleFilesCommit } from './files'
import { handleLlm } from './llm'
import { handleMcp } from './mcp'
import { openapiSpec } from './openapi'
import { handleRelease, healthPayload } from './release'
import { handleRest } from './rest'
import { handleTasks } from './tasks'
import { handleWorkspaceExport } from './workspace'
import { CORS_HEADERS, jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

export { ApprovalStore } from './approvalStore'

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function isAuthorized(req: Request, env: Env): Promise<boolean> {
  const header = req.headers.get('Authorization') ?? ''
  // Some MCP hosts (e.g. Claude's custom-connector UI) can't set custom
  // headers, so the token may also ride in a ?key= query parameter.
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (new URL(req.url).searchParams.get('key') ?? '')
  const expected = resolveSecret(env, 'AUTH_TOKEN')
  if (!token || !expected) return false

  const [actualHash, expectedHash] = await Promise.all([digest(token), digest(expected)])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index]
  }
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
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(req.url)

    if (url.pathname === '/health') {
      const response = jsonResponse(healthPayload(env))
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    // Public schema discovery for ChatGPT Custom GPT Actions and REST clients.
    if (url.pathname === '/openapi.json' && req.method === 'GET') {
      return jsonResponse(openapiSpec(url.origin))
    }

    if (!(await isAuthorized(req, env))) return unauthorized()

    if (url.pathname === '/mcp' && (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')) {
      return handleMcp(req, env)
    }

    const actionResponse = await handleActions(req, env, url)
    if (actionResponse) return actionResponse

    const approvalResponse = await handleApprovals(req, env, url)
    if (approvalResponse) return approvalResponse

    const taskResponse = await handleTasks(req, env, url)
    if (taskResponse) return taskResponse

    const releaseResponse = await handleRelease(req, env, url)
    if (releaseResponse) return releaseResponse

    if (url.pathname === '/api/llm' && req.method === 'POST') {
      return handleLlm(req, env)
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      // Keep the in-app agent available by default; it can be explicitly disabled.
      if (disabledExplicitly(env.ENABLE_LEGACY_AGENT)) {
        return jsonError('In-app AI agent is disabled by configuration (ENABLE_LEGACY_AGENT=false).', 410)
      }
      return handleChat(req, env)
    }

    if (url.pathname === '/api/files/commit' && req.method === 'POST') {
      return handleFilesCommit(req, env)
    }

    if (url.pathname === '/api/workspace/export' && req.method === 'POST') {
      return handleWorkspaceExport(req, env)
    }

    const restResponse = await handleRest(req, env, url)
    if (restResponse) return restResponse

    return jsonError('Not found', 404)
  },
}
