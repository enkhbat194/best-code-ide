import { handleChat } from './chat'
import { handleFilesCommit } from './files'
import { handleMcp } from './mcp'
import { openapiSpec } from './openapi'
import { handleRest } from './rest'
import { CORS_HEADERS, jsonError, jsonResponse } from './utils'
import type { Env } from './types'

function isAuthorized(req: Request, env: Env): boolean {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return Boolean(env.AUTH_TOKEN) && token === env.AUTH_TOKEN
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return jsonResponse({ ok: true })
    }

    // Schema discovery is public so ChatGPT (and humans) can inspect the API before authenticating.
    if (url.pathname === '/openapi.json' && req.method === 'GET') {
      return jsonResponse(openapiSpec(url.origin))
    }

    if (!isAuthorized(req, env)) {
      return jsonError('Unauthorized — missing or invalid Bearer token', 401)
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      return handleChat(req, env)
    }

    if (url.pathname === '/api/files/commit' && req.method === 'POST') {
      return handleFilesCommit(req, env)
    }

    if (url.pathname === '/mcp' && req.method === 'POST') {
      return handleMcp(req, env)
    }

    const restResponse = await handleRest(req, env, url)
    if (restResponse) return restResponse

    return jsonError('Not found', 404)
  },
}
