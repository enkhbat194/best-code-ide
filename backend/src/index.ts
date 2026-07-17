import { handleApprovals } from './approvals'
import { handleChat } from './chat'
import { handleFilesCommit } from './files'
import { handleMcp } from './mcp'
import { openapiSpec } from './openapi'
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
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expected = resolveSecret(env, 'AUTH_TOKEN')
  if (!token || !expected) return false

  const [actualHash, expectedHash] = await Promise.all([digest(token), digest(expected)])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index]
  }
  return difference === 0
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
      return jsonResponse({ ok: true, build: 'git-delivery-build-v1' })
    }

    // Public schema discovery for legacy REST/OpenAPI clients.
    if (url.pathname === '/openapi.json' && req.method === 'GET') {
      return jsonResponse(openapiSpec(url.origin))
    }

    if (!(await isAuthorized(req, env))) return unauthorized()

    if (url.pathname === '/mcp' && (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')) {
      return handleMcp(req, env)
    }

    const approvalResponse = await handleApprovals(req, env, url)
    if (approvalResponse) return approvalResponse

    const taskResponse = await handleTasks(req, env, url)
    if (taskResponse) return taskResponse

    if (url.pathname === '/api/chat' && req.method === 'POST') {
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
