import { deliveryMcpTools, executeDeliveryMcpTool } from './mcpDeliveryTools'
import { executeReadOnlyMcpTool, readOnlyMcpTools } from './mcpReadTools'
import { executeSafeWriteMcpTool, safeWriteMcpTools } from './mcpWriteTools'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

const READ_ONLY_NAMES = new Set<string>(readOnlyMcpTools.map((tool) => tool.name))
const SAFE_WRITE_NAMES = new Set<string>(safeWriteMcpTools.map((tool) => tool.name))
const DELIVERY_NAMES = new Set<string>(deliveryMcpTools.map((tool) => tool.name))
const ACTION_NAMES = new Set<string>([...READ_ONLY_NAMES, ...SAFE_WRITE_NAMES, ...DELIVERY_NAMES])

function validArguments(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * REST adapter for ChatGPT Custom GPT Actions and other OpenAPI clients.
 * It deliberately reuses the MCP executors so project allowlists, approval
 * requirements, protected-branch checks, conflict checks, and task rules stay
 * identical across MCP and Actions.
 */
export async function handleActions(req: Request, env: Env, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/actions\/([a-z0-9_-]+)$/i)
  if (!match) return null

  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const toolName = match[1]
  if (!ACTION_NAMES.has(toolName)) return jsonError(`Unknown BestCode action: ${toolName}`, 404)

  const parsed = await req.json().catch(() => null)
  if (!validArguments(parsed)) return jsonError('Action request body must be a JSON object', 400)

  const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
  if (!githubToken) return jsonError('GITHUB_TOKEN secret is missing', 500)

  const startedAt = Date.now()
  const result = READ_ONLY_NAMES.has(toolName)
    ? await executeReadOnlyMcpTool(toolName, parsed, githubToken, env)
    : SAFE_WRITE_NAMES.has(toolName)
      ? await executeSafeWriteMcpTool(toolName, parsed, githubToken, env)
      : await executeDeliveryMcpTool(toolName, parsed, githubToken, env)

  console.log(JSON.stringify({
    event: 'openapi_action_call',
    tool: toolName,
    operation_id: result.structuredContent.operation_id,
    ok: result.structuredContent.ok,
    status: result.structuredContent.status,
    duration_ms: Date.now() - startedAt,
  }))

  // Tool failures remain structured 200 responses so the calling model can
  // inspect error.code/action_required and recover without losing the payload.
  const response = jsonResponse(result.structuredContent)
  response.headers.set('X-BestCode-Action', toolName)
  return response
}
