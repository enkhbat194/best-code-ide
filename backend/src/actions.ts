import {
  executeGatewayTool,
  gatewayContextFromRequest,
  gatewayTool,
} from './toolGateway'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

function validArguments(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** REST adapter for ChatGPT Custom GPT Actions and other OpenAPI clients. */
export async function handleActions(req: Request, env: Env, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/actions\/([a-z0-9_-]+)$/i)
  if (!match) return null
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const toolName = match[1]
  if (!gatewayTool('legacy', toolName)) return jsonError(`Unknown BestCode action: ${toolName}`, 404)

  const parsed = await req.json().catch(() => null)
  if (!validArguments(parsed)) return jsonError('Action request body must be a JSON object', 400)

  const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
  if (!githubToken) return jsonError('GITHUB_TOKEN secret is missing', 500)

  const context = gatewayContextFromRequest(req, 'legacy', 'openapi')
  const result = await executeGatewayTool('legacy', toolName, parsed, githubToken, env, context)

  console.log(JSON.stringify({
    event: 'openapi_action_call',
    request_id: context.request_id,
    actor: context.actor,
    tool: toolName,
    operation_id: result.structuredContent.operation_id,
    ok: result.structuredContent.ok,
    status: result.structuredContent.status,
    safety_class: result.structuredContent.safety_class,
    audit: result.structuredContent.audit,
  }))

  const response = jsonResponse(result.structuredContent)
  response.headers.set('X-BestCode-Action', toolName)
  response.headers.set('X-BestCode-Request-Id', context.request_id)
  return response
}
