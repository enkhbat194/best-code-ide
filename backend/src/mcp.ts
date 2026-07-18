import { deliveryMcpTools, executeDeliveryMcpTool } from './mcpDeliveryTools'
import { deploymentMcpTools, executeDeploymentMcpTool } from './mcpDeploymentTools'
import { executeReadOnlyMcpTool, readOnlyMcpTools } from './mcpReadTools'
import { executeSafeWriteMcpTool, safeWriteMcpTools } from './mcpWriteTools'
import { resolveSecret } from './utils'
import type { Env } from './types'

const LATEST_PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26'])
const DEFAULT_BROWSER_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com']
const ALL_MCP_TOOLS = [...readOnlyMcpTools, ...safeWriteMcpTools, ...deliveryMcpTools, ...deploymentMcpTools]
const READ_ONLY_NAMES = new Set<string>(readOnlyMcpTools.map((tool) => tool.name))
const SAFE_WRITE_NAMES = new Set<string>(safeWriteMcpTools.map((tool) => tool.name))
const DELIVERY_NAMES = new Set<string>(deliveryMcpTools.map((tool) => tool.name))
const DEPLOYMENT_NAMES = new Set<string>(deploymentMcpTools.map((tool) => tool.name))

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: unknown
}

function jsonHeaders(extra: HeadersInit = {}): HeadersInit {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
}

function rpcResponse(id: string | number | null | undefined, result: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }), { headers: jsonHeaders(headers) })
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  status = 400,
  data?: unknown,
): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }), {
    status,
    headers: jsonHeaders(),
  })
}

function allowedOrigins(req: Request, env: Env): Set<string> {
  const configured = (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  return new Set([new URL(req.url).origin, ...DEFAULT_BROWSER_ORIGINS, ...configured])
}

function validateOrigin(req: Request, env: Env): Response | null {
  const origin = req.headers.get('Origin')
  if (!origin || allowedOrigins(req, env).has(origin)) return null
  return rpcError(undefined, -32001, 'Forbidden origin', 403, {
    code: 'ORIGIN_NOT_ALLOWED',
    action_required: 'Add the exact trusted origin to MCP_ALLOWED_ORIGINS in Cloudflare configuration.',
  })
}

function validateProtocolVersion(req: Request, method: string): Response | null {
  if (method === 'initialize') return null
  const supplied = req.headers.get('MCP-Protocol-Version') ?? '2025-03-26'
  if (SUPPORTED_PROTOCOL_VERSIONS.has(supplied)) return null
  return rpcError(undefined, -32600, `Unsupported MCP protocol version: ${supplied}`, 400, {
    supported_versions: [...SUPPORTED_PROTOCOL_VERSIONS],
  })
}

function validateAccept(req: Request): Response | null {
  const accept = req.headers.get('Accept') ?? ''
  const acceptsJson = accept.includes('application/json') || accept.includes('*/*')
  const acceptsEvents = accept.includes('text/event-stream') || accept.includes('*/*')
  return acceptsJson && acceptsEvents
    ? null
    : rpcError(undefined, -32600, 'MCP POST requests must accept application/json and text/event-stream', 406)
}

function isNotification(message: JsonRpcMessage): boolean {
  return typeof message.method === 'string' && message.id === undefined
}

function isJsonRpcResponse(message: JsonRpcMessage): boolean {
  return message.method === undefined && (message.result !== undefined || message.error !== undefined)
}

function negotiatedVersion(params: Record<string, unknown> | undefined): string {
  const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
  return SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : LATEST_PROTOCOL_VERSION
}

function methodHeaders(method: string, toolName?: string): HeadersInit {
  return {
    'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    'MCP-Method': method,
    ...(toolName ? { 'MCP-Name': toolName } : {}),
  }
}

function missingGithubTokenResult() {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'GITHUB_TOKEN_MISSING', message: 'GitHub access is not configured.' } }) }],
    structuredContent: {
      ok: false,
      operation_id: crypto.randomUUID(),
      status: 'failed',
      error: {
        code: 'GITHUB_TOKEN_MISSING',
        message: 'GitHub access is not configured.',
        retryable: false,
        action_required: 'Set GITHUB_TOKEN in Cloudflare Secrets.',
      },
    },
    isError: true,
  }
}

/** Stateless JSON-response Streamable HTTP MCP endpoint. */
export async function handleMcp(req: Request, env: Env): Promise<Response> {
  const originError = validateOrigin(req, env)
  if (originError) return originError

  if (req.method === 'GET' || req.method === 'DELETE') {
    return new Response(null, { status: 405, headers: { Allow: 'POST, GET', 'Cache-Control': 'no-store' } })
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST, GET' } })

  const acceptError = validateAccept(req)
  if (acceptError) return acceptError

  let message: JsonRpcMessage
  try {
    const parsed = await req.json()
    if (Array.isArray(parsed) || !parsed || typeof parsed !== 'object') {
      return rpcError(undefined, -32600, 'A single JSON-RPC object is required')
    }
    message = parsed as JsonRpcMessage
  } catch {
    return rpcError(undefined, -32700, 'Parse error')
  }

  if (message.jsonrpc !== '2.0') return rpcError(message.id, -32600, 'jsonrpc must equal 2.0')
  if (isJsonRpcResponse(message)) return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  if (typeof message.method !== 'string') return rpcError(message.id, -32600, 'Missing JSON-RPC method')

  const protocolError = validateProtocolVersion(req, message.method)
  if (protocolError) return protocolError
  if (isNotification(message)) return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } })

  switch (message.method) {
    case 'initialize': {
      const protocolVersion = negotiatedVersion(message.params)
      return rpcResponse(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'bestcode-repository-controller',
          title: 'BestCode Repository Controller',
          version: '0.8.0',
          description: 'Project-scoped repository controller with approval-gated Git delivery, CI tasks, and production deployment.',
        },
        instructions:
          'Use projects_list first. Work on agent/<task>. Stage changes, wait for user approval, commit, push, run build/test, and create a draft PR. Production deployment requires a separate high-risk approval operation and only deploys the project default branch.',
      }, { 'MCP-Protocol-Version': protocolVersion })
    }

    case 'ping':
      return rpcResponse(message.id, {}, methodHeaders('ping'))

    case 'tools/list':
      return rpcResponse(message.id, { tools: ALL_MCP_TOOLS }, methodHeaders('tools/list'))

    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? message.params.name : ''
      const args = message.params?.arguments
      if (!name) return rpcError(message.id, -32602, 'Missing tool name')
      if (!READ_ONLY_NAMES.has(name) && !SAFE_WRITE_NAMES.has(name) && !DELIVERY_NAMES.has(name) && !DEPLOYMENT_NAMES.has(name)) {
        return rpcError(message.id, -32602, `Unknown MCP tool: ${name}`)
      }
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return rpcError(message.id, -32602, 'Tool arguments must be a JSON object')
      }

      const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
      if (!githubToken) return rpcResponse(message.id, missingGithubTokenResult(), methodHeaders('tools/call', name))

      const startedAt = Date.now()
      const toolArgs = (args as Record<string, unknown> | undefined) ?? {}
      const result = READ_ONLY_NAMES.has(name)
        ? await executeReadOnlyMcpTool(name, toolArgs, githubToken, env)
        : SAFE_WRITE_NAMES.has(name)
          ? await executeSafeWriteMcpTool(name, toolArgs, githubToken, env)
          : DELIVERY_NAMES.has(name)
            ? await executeDeliveryMcpTool(name, toolArgs, githubToken, env)
            : await executeDeploymentMcpTool(name, toolArgs, githubToken, env)

      console.log(JSON.stringify({
        event: 'mcp_tool_call',
        tool: name,
        operation_id: result.structuredContent.operation_id,
        ok: result.structuredContent.ok,
        status: result.structuredContent.status,
        duration_ms: Date.now() - startedAt,
      }))
      return rpcResponse(message.id, result, methodHeaders('tools/call', name))
    }

    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}`)
  }
}
