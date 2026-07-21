import { deliveryMcpTools, executeDeliveryMcpTool } from './mcpDeliveryTools'
import { deploymentMcpTools, executeDeploymentMcpTool } from './mcpDeploymentTools'
import { executeReadOnlyMcpTool, readOnlyMcpTools } from './mcpReadTools'
import { executeRollbackMcpTool, rollbackMcpTools } from './mcpRollbackTools'
import { executeSafeWriteMcpTool, safeWriteMcpTools } from './mcpWriteTools'
import { executeProjectBrainMcpTool, projectBrainMcpTools } from './projectBrainTools'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

const READ_ONLY_NAMES = new Set<string>(readOnlyMcpTools.map((tool) => tool.name))
const SAFE_WRITE_NAMES = new Set<string>(safeWriteMcpTools.map((tool) => tool.name))
const DELIVERY_NAMES = new Set<string>(deliveryMcpTools.map((tool) => tool.name))
const DEPLOYMENT_NAMES = new Set<string>(deploymentMcpTools.map((tool) => tool.name))
const ROLLBACK_NAMES = new Set<string>(rollbackMcpTools.map((tool) => tool.name))
const PROJECT_BRAIN_NAMES = new Set<string>(projectBrainMcpTools.map((tool) => tool.name))
const ACTION_NAMES = new Set<string>([
  ...READ_ONLY_NAMES,
  ...SAFE_WRITE_NAMES,
  ...DELIVERY_NAMES,
  ...DEPLOYMENT_NAMES,
  ...ROLLBACK_NAMES,
  ...PROJECT_BRAIN_NAMES,
])

function validArguments(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** REST adapter for ChatGPT Custom GPT Actions and other OpenAPI clients. */
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
      : DELIVERY_NAMES.has(toolName)
        ? await executeDeliveryMcpTool(toolName, parsed, githubToken, env)
        : DEPLOYMENT_NAMES.has(toolName)
          ? await executeDeploymentMcpTool(toolName, parsed, githubToken, env)
          : ROLLBACK_NAMES.has(toolName)
            ? await executeRollbackMcpTool(toolName, parsed, githubToken, env)
            : await executeProjectBrainMcpTool(toolName, parsed, githubToken, env)

  console.log(JSON.stringify({
    event: 'openapi_action_call',
    tool: toolName,
    operation_id: result.structuredContent.operation_id,
    ok: result.structuredContent.ok,
    status: result.structuredContent.status,
    duration_ms: Date.now() - startedAt,
  }))

  const response = jsonResponse(result.structuredContent)
  response.headers.set('X-BestCode-Action', toolName)
  return response
}
