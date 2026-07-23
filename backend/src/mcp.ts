import {
  executeGatewayTool,
  gatewayContextFromRequest,
  gatewayTools,
  isKnownGatewayTool,
  type GatewayProfile,
} from './toolGateway'
import { resolveSecret } from './utils'
import type { Env } from './types'

const LATEST_PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26'])
const DEFAULT_BROWSER_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com']

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

function rpcError(id: string | number | null | undefined, code: number, message: string, status = 400, data?: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }),
    { status, headers: jsonHeaders() },
  )
}

function profileForRequest(req: Request): GatewayProfile {
  return new URL(req.url).pathname === '/mcp/subscription' ? 'subscription-readonly' : 'legacy'
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

function responseProtocolVersion(req: Request): string {
  const supplied = req.headers.get('MCP-Protocol-Version')
  return supplied && SUPPORTED_PROTOCOL_VERSIONS.has(supplied) ? supplied : LATEST_PROTOCOL_VERSION
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

function methodHeaders(req: Request, method: string, toolName?: string): HeadersInit {
  return {
    'MCP-Protocol-Version': responseProtocolVersion(req),
    'MCP-Method': method,
    ...(toolName ? { 'MCP-Name': toolName } : {}),
  }
}

function missingGithubTokenResult(req: Request, profile: GatewayProfile) {
  const context = gatewayContextFromRequest(req, profile, 'mcp')
  const structuredContent = {
    ok: false,
    operation_id: crypto.randomUUID(),
    status: 'failed',
    request_id: context.request_id,
    actor: context.actor,
    project_scope: context.project_scope ?? null,
    error: {
      code: 'GITHUB_TOKEN_MISSING',
      message: 'GitHub access is not configured.',
      retryable: false,
      action_required: 'Set GITHUB_TOKEN in Cloudflare Secrets.',
    },
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  }
}

/** Stateless JSON-response Streamable HTTP MCP endpoint. */
export async function handleMcp(req: Request, env: Env): Promise<Response> {
  const profile = profileForRequest(req)
  const originError = validateOrigin(req, env)
  if (originError) return originError

  if (req.method === 'GET' || req.method === 'DELETE') {
    return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })

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
      const subscription = profile === 'subscription-readonly'
      return rpcResponse(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: subscription ? 'bestcode-subscription-agent-gateway' : 'bestcode-repository-controller',
          title: subscription ? 'BestCode Subscription Agent Gateway' : 'BestCode Repository Controller',
          version: '0.12.0',
          description: subscription
            ? 'Authenticated, project-scoped, provider-neutral read-only gateway for subscription coding agents.'
            : 'Project-scoped controller with Missions, Project Brain, approval-gated Git delivery, CI, deployment, and rollback requests.',
        },
        instructions: subscription
          ? 'Use projects_list, brain_export_summary, repository reads, Mission reads, and handoff_packet_build. This endpoint cannot mutate repositories, approvals, deployments, or production.'
          : 'Use projects_list then project_context_get or mission_get. Work on agent/<task>, stage coherent changes, wait for owner approval, run CI, and create PRs.',
      }, { 'MCP-Protocol-Version': protocolVersion })
    }

    case 'ping':
      return rpcResponse(message.id, {}, methodHeaders(req, 'ping'))

    case 'tools/list':
      return rpcResponse(message.id, { tools: gatewayTools(profile) }, methodHeaders(req, 'tools/list'))

    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? message.params.name : ''
      const args = message.params?.arguments
      if (!name) return rpcError(message.id, -32602, 'Missing tool name')
      if (!isKnownGatewayTool(name)) return rpcError(message.id, -32602, `Unknown MCP tool: ${name}`)
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return rpcError(message.id, -32602, 'Tool arguments must be a JSON object')
      }

      const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
      if (!githubToken) {
        return rpcResponse(message.id, missingGithubTokenResult(req, profile), methodHeaders(req, 'tools/call', name))
      }

      const context = gatewayContextFromRequest(req, profile, 'mcp')
      const result = await executeGatewayTool(
        profile,
        name,
        (args as Record<string, unknown> | undefined) ?? {},
        githubToken,
        env,
        context,
      )
      const audit = result.structuredContent.audit
      console.log(JSON.stringify({
        event: 'mcp_tool_call',
        request_id: context.request_id,
        actor: context.actor,
        project_scope: context.project_scope ?? null,
        tool: name,
        operation_id: result.structuredContent.operation_id,
        ok: result.structuredContent.ok,
        status: result.structuredContent.status,
        safety_class: result.structuredContent.safety_class,
        audit,
      }))
      return rpcResponse(message.id, result, methodHeaders(req, 'tools/call', name))
    }

    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}`)
  }
}
