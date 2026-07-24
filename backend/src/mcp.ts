import { persistSecurityAudit } from './securityAudit'
import { authorizeBoundedWriteOperation } from './boundedWriteCredentials'
import type { RequestPrincipal } from './subscriptionCredentialTypes'
import {
  executeGatewayTool,
  gatewayContextFromRequest,
  gatewayTools,
  isKnownGatewayTool,
  type GatewayProfile,
  type GatewayToolResult,
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

function profileForRequest(req: Request, principal: RequestPrincipal): GatewayProfile {
  if (principal.kind === 'bounded-write') return 'subscription-write-bounded'
  return new URL(req.url).pathname === '/mcp/subscription' ? 'subscription-readonly' : 'legacy'
}

async function requestForPrincipal(req: Request, principal: RequestPrincipal): Promise<Request> {
  if (principal.kind === 'owner') return req
  const url = new URL(req.url)
  url.searchParams.set('project_id', principal.project_id)
  url.searchParams.delete('agent_id')
  url.searchParams.delete('agent_provider')
  const headers = new Headers(req.headers)
  headers.set('X-BestCode-Agent-Id', principal.agent_id)
  headers.set('X-BestCode-Agent-Provider', principal.provider)
  headers.delete('X-BestCode-Agent-Session')
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.clone().arrayBuffer()
  return new Request(url.toString(), {
    method: req.method,
    headers,
    body,
    redirect: req.redirect,
    signal: req.signal,
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
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  }
}

function withCredentialAudit(result: GatewayToolResult, principal: RequestPrincipal): GatewayToolResult {
  if (principal.kind === 'owner') return result
  const prior = result.structuredContent && typeof result.structuredContent === 'object'
    ? result.structuredContent as Record<string, any>
    : {}
  const audit = prior.audit && typeof prior.audit === 'object' ? prior.audit as Record<string, unknown> : {}
  const structuredContent = {
    ...prior,
    actor: { id: principal.agent_id, provider: principal.provider },
    project_scope: principal.project_id,
    audit: {
      ...audit,
      credential_id: principal.credential_id,
      project_id: principal.project_id,
      agent_id: principal.agent_id,
      provider: principal.provider,
      mcp_profile: principal.profile,
      credential_version: principal.credential_version,
      ...('tool_set_version' in principal ? { tool_set_version: principal.tool_set_version } : {}),
      ...('scope_hash' in principal ? { scope_hash: principal.scope_hash } : {}),
      ...(prior.error?.code ? { denial_code: prior.error.code } : {}),
    },
  }
  return {
    ...result,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const expression = escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp(`^${expression}$`, 'i').test(value)
}

function boundedWriteArguments(
  principal: Extract<RequestPrincipal, { kind: 'bounded-write' }>,
  name: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (raw.project_id !== undefined && raw.project_id !== principal.project_id) throw new Error('PROJECT_SCOPE_DENIED')
  const args: Record<string, unknown> = { ...raw, project_id: principal.project_id }
  const branch = typeof args.branch === 'string' ? args.branch : undefined
  const branchName = typeof args.name === 'string' ? args.name : undefined
  if (branch && branch !== principal.branch) throw new Error('BRANCH_SCOPE_DENIED')
  if (branchName && branchName !== principal.branch) throw new Error('BRANCH_SCOPE_DENIED')
  if (name === 'repository_create_branch') {
    args.name = principal.branch
    args.from_branch = 'main'
    args.expected_base_sha = principal.base_sha
  }
  if (name === 'repository_write_file' || name === 'repository_apply_patch') {
    args.branch = principal.branch
    args.expected_branch_head_sha = principal.base_sha
  }
  if (name === 'build_start' || name === 'test_start') args.branch = principal.branch
  if (name === 'repository_create_pull_request') {
    args.base = 'main'
    args.draft = true
  }
  if (name.startsWith('mission_')) {
    args.mission_id = principal.mission_id
    args.task_id = principal.task_id
    args.attempt_id = principal.attempt_id
    args.lease_id = principal.lease_id
    args.fencing_token = principal.fencing_token
    if (name === 'mission_task_progress_append' || name === 'mission_task_result_submit' || name === 'mission_task_lease_release') {
      args.idempotency_key = raw.idempotency_key
    }
  }
  if (typeof args.path === 'string') {
    const path = args.path.replace(/^\/+/, '')
    if (principal.denied_paths.some((pattern) => globMatches(pattern, path))) throw new Error('PROTECTED_PATH_DENIED')
    if (!principal.allowed_paths.some((pattern) => globMatches(pattern, path))) throw new Error('PATH_SCOPE_DENIED')
    args.path = path
  }
  return args
}

const BOUNDED_MUTATIONS = new Set([
  'repository_create_branch', 'repository_write_file', 'repository_apply_patch',
  'repository_commit', 'repository_push', 'repository_create_pull_request',
  'build_start', 'test_start',
  'mission_task_progress_append', 'mission_task_result_submit', 'mission_task_lease_release',
])

function boundedOperationCost(name: string, args: Record<string, unknown>) {
  const changed = name === 'repository_write_file' || name === 'repository_apply_patch'
  const content = typeof args.content === 'string' ? args.content : typeof args.patch === 'string' ? args.patch : ''
  return {
    changed_files: changed ? 1 : 0,
    changed_bytes: changed ? new TextEncoder().encode(content).byteLength : 0,
    commits: name === 'repository_commit' ? 1 : 0,
    pushes: name === 'repository_push' ? 1 : 0,
    pull_requests: name === 'repository_create_pull_request' ? 1 : 0,
  }
}

async function persistBoundedDenial(
  env: Env,
  req: Request,
  principal: Extract<RequestPrincipal, { kind: 'bounded-write' }>,
  tool: string,
  code: string,
  requestId?: string,
): Promise<void> {
  await persistSecurityAudit(env, 'bounded_write_mutation_denied', {
    path: new URL(req.url).pathname,
    method: req.method,
    identity: 'unknown',
    request_id: requestId,
    credential_id: principal.credential_id,
    project_id: principal.project_id,
    mission_id: principal.mission_id,
    task_id: principal.task_id,
    attempt_id: principal.attempt_id,
    lease_id: principal.lease_id,
    fencing_token: principal.fencing_token,
    agent_id: principal.agent_id,
    provider: principal.provider,
    branch: principal.branch,
    scope_hash: principal.scope_hash,
    tool,
    denial_code: code,
  }).catch(() => undefined)
}

/** Stateless JSON-response Streamable HTTP MCP endpoint. */
export async function handleMcp(
  req: Request,
  env: Env,
  principal: RequestPrincipal = { kind: 'owner', identity: 'owner' },
): Promise<Response> {
  const effectiveRequest = await requestForPrincipal(req, principal)
  const profile = profileForRequest(effectiveRequest, principal)
  const url = new URL(effectiveRequest.url)

  if (principal.kind !== 'owner') {
    const expectedProfile = principal.kind === 'bounded-write' ? 'subscription-write-bounded' : principal.profile
    if (url.pathname !== '/mcp/subscription' || profile !== expectedProfile) {
      return rpcError(undefined, -32001, 'Forbidden', 403, { code: 'ENDPOINT_NOT_ALLOWED' })
    }
    if (url.searchParams.get('project_id') !== principal.project_id) {
      return rpcError(undefined, -32001, 'Forbidden', 403, { code: 'PROJECT_SCOPE_MISMATCH' })
    }
  }

  const originError = validateOrigin(effectiveRequest, env)
  if (originError) return originError

  if (effectiveRequest.method === 'GET' || effectiveRequest.method === 'DELETE') {
    return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
  }
  if (effectiveRequest.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })

  const acceptError = validateAccept(effectiveRequest)
  if (acceptError) return acceptError

  let message: JsonRpcMessage
  try {
    const parsed = await effectiveRequest.json()
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

  const protocolError = validateProtocolVersion(effectiveRequest, message.method)
  if (protocolError) return protocolError
  if (isNotification(message)) return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } })

  switch (message.method) {
    case 'initialize': {
      const protocolVersion = negotiatedVersion(message.params)
      const subscription = profile !== 'legacy'
      const boundedWrite = profile === 'subscription-write-bounded'
      return rpcResponse(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: boundedWrite ? 'bestcode-bounded-write-agent-gateway' : subscription ? 'bestcode-subscription-agent-gateway' : 'bestcode-repository-controller',
          title: boundedWrite ? 'BestCode Bounded Write' : subscription ? 'BestCode Read Only' : 'BestCode Repository Controller',
          version: '0.13.0',
          description: boundedWrite
            ? 'Authenticated task-scoped gateway for owner-approved bounded repository changes.'
            : subscription
            ? 'Authenticated, project-scoped, provider-neutral read-only gateway for subscription coding agents.'
            : 'Project-scoped controller with Missions, Project Brain, approval-gated Git delivery, CI, deployment, and rollback requests.',
        },
        instructions: boundedWrite
          ? 'Operate only on the bound project, Mission task, branch, base SHA, paths, tools, and limits. Merge, deploy, rollback, secrets, approval, and arbitrary shell are unavailable.'
          : subscription
          ? 'Use projects_list, brain_export_summary, repository reads, Mission reads, and handoff_packet_build. This endpoint cannot mutate repositories, approvals, deployments, or production.'
          : 'Use projects_list then project_context_get or mission_get. Work on agent/<task>, stage coherent changes, wait for owner approval, run CI, and create PRs.',
      }, { 'MCP-Protocol-Version': protocolVersion })
    }

    case 'ping':
      return rpcResponse(message.id, {}, methodHeaders(effectiveRequest, 'ping'))

    case 'tools/list': {
      const tools = gatewayTools(profile)
      const advertised = principal.kind === 'bounded-write'
        ? tools.filter((tool) => principal.allowed_tools.includes(tool.name))
        : tools
      return rpcResponse(message.id, { tools: advertised }, methodHeaders(effectiveRequest, 'tools/list'))
    }

    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? message.params.name : ''
      const args = message.params?.arguments
      if (!name) return rpcError(message.id, -32602, 'Missing tool name')
      if (!isKnownGatewayTool(name)) return rpcError(message.id, -32602, `Unknown MCP tool: ${name}`)
      if (principal.kind === 'bounded-write' && !principal.allowed_tools.includes(name)) {
        await persistBoundedDenial(env, effectiveRequest, principal, name, 'TOOL_SCOPE_DENIED')
        return rpcError(message.id, -32001, 'Tool is outside credential scope', 403, { code: 'TOOL_SCOPE_DENIED' })
      }
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return rpcError(message.id, -32602, 'Tool arguments must be a JSON object')
      }

      const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
      const context = gatewayContextFromRequest(effectiveRequest, profile, 'mcp')
      let result: GatewayToolResult
      let effectiveArgs = (args as Record<string, unknown> | undefined) ?? {}
      if (principal.kind === 'bounded-write') {
        try {
          effectiveArgs = boundedWriteArguments(principal, name, effectiveArgs)
        } catch (error) {
          const code = error instanceof Error ? error.message : 'BOUNDED_WRITE_SCOPE_DENIED'
          await persistBoundedDenial(env, effectiveRequest, principal, name, code, context.request_id)
          return rpcError(message.id, -32001, 'Request is outside credential scope', 403, {
            code,
          })
        }
        if (BOUNDED_MUTATIONS.has(name)) {
          const idempotencyKey = context.idempotency_key
          if (!idempotencyKey) {
            await persistBoundedDenial(env, effectiveRequest, principal, name, 'IDEMPOTENCY_KEY_REQUIRED', context.request_id)
            return rpcError(message.id, -32001, 'Idempotency-Key is required for bounded mutations', 400, {
              code: 'IDEMPOTENCY_KEY_REQUIRED',
            })
          }
          try {
            const authorization = await authorizeBoundedWriteOperation(env, principal, {
              tool: name,
              idempotency_key: idempotencyKey,
              ...boundedOperationCost(name, effectiveArgs),
            })
            if (authorization.replayed) {
              await persistSecurityAudit(env, 'bounded_write_idempotent_replay', {
                identity: 'unknown',
                request_id: context.request_id,
                credential_id: principal.credential_id,
                project_id: principal.project_id,
                mission_id: principal.mission_id,
                task_id: principal.task_id,
                attempt_id: principal.attempt_id,
                lease_id: principal.lease_id,
                fencing_token: principal.fencing_token,
                agent_id: principal.agent_id,
                provider: principal.provider,
                branch: principal.branch,
                scope_hash: principal.scope_hash,
                tool: name,
                idempotency_key: idempotencyKey,
              }).catch(() => undefined)
              return rpcResponse(message.id, {
                content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'replayed', idempotency_key: idempotencyKey }) }],
                structuredContent: {
                  ok: true,
                  status: 'replayed',
                  idempotency: { provided: true, replayed: true, persisted: true },
                  usage: authorization.usage,
                },
              }, methodHeaders(effectiveRequest, 'tools/call', name))
            }
          } catch (error) {
            const code = error instanceof Error ? error.message : 'BOUNDED_WRITE_OPERATION_DENIED'
            await persistBoundedDenial(env, effectiveRequest, principal, name, code, context.request_id)
            return rpcError(message.id, -32001, 'Bounded mutation authorization denied', 403, {
              code,
            })
          }
        }
      }
      if (!githubToken) {
        result = missingGithubTokenResult(effectiveRequest, profile)
      } else {
        result = await executeGatewayTool(
          profile,
          name,
          effectiveArgs,
          githubToken,
          env,
          context,
        )
      }
      result = withCredentialAudit(result, principal)
      const audit = result.structuredContent.audit
      const auditRecord = {
        event: 'mcp_tool_call',
        request_id: context.request_id,
        actor: result.structuredContent.actor ?? context.actor,
        project_scope: result.structuredContent.project_scope ?? context.project_scope ?? null,
        tool: name,
        operation_id: result.structuredContent.operation_id,
        ok: result.structuredContent.ok,
        status: result.structuredContent.status,
        safety_class: result.structuredContent.safety_class,
        audit,
      }
      console.log(JSON.stringify(auditRecord))
      await persistSecurityAudit(env, 'mcp_tool_call', {
        path: url.pathname,
        method: effectiveRequest.method,
        identity: principal.kind === 'owner' ? 'owner' : 'unknown',
        request_id: context.request_id,
        tool: name,
        outcome: audit?.outcome ?? (result.isError ? 'failed' : 'completed'),
        denial_code: result.structuredContent.error?.code,
        auth_type: principal.kind,
        ...(principal.kind !== 'owner' ? {
          credential_id: principal.credential_id,
          project_id: principal.project_id,
          agent_id: principal.agent_id,
          provider: principal.provider,
          mcp_profile: principal.profile,
          credential_version: principal.credential_version,
          ...('tool_set_version' in principal ? { tool_set_version: principal.tool_set_version } : {}),
          ...('scope_hash' in principal ? {
            mission_id: principal.mission_id,
            task_id: principal.task_id,
            attempt_id: principal.attempt_id,
            lease_id: principal.lease_id,
            fencing_token: principal.fencing_token,
            branch: principal.branch,
            scope_hash: principal.scope_hash,
          } : {}),
        } : {}),
      }).catch((error) => {
        console.error('MCP audit persistence failed', error instanceof Error ? error.message : String(error))
      })
      return rpcResponse(message.id, result, methodHeaders(effectiveRequest, 'tools/call', name))
    }

    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}`)
  }
}
