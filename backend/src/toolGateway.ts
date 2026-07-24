import { deliveryMcpTools, executeDeliveryMcpTool } from './mcpDeliveryTools'
import { deploymentMcpTools, executeDeploymentMcpTool } from './mcpDeploymentTools'
import { executeReadOnlyMcpTool, readOnlyMcpTools } from './mcpReadTools'
import { executeRollbackMcpTool, rollbackMcpTools } from './mcpRollbackTools'
import { executeSafeWriteMcpTool, safeWriteMcpTools } from './mcpWriteTools'
import { executeMissionMcpTool, missionMcpTools } from './missionTools'
import { executeMissionExecutionTool, missionExecutionMcpTools } from './missionExecutionTools'
import { executeProjectBrainMcpTool, projectBrainMcpTools } from './projectBrainTools'
import { executeSubscriptionTool, subscriptionMcpTools } from './subscriptionTools'
import type { Env } from './types'

export type GatewayProfile = 'legacy' | 'subscription-readonly'
export type ToolSafetyClass = 'read-only' | 'write-without-approval' | 'approval-required' | 'irreversible'

interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface GatewayTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations: ToolAnnotations
  _meta?: Record<string, unknown>
}

export interface AgentIdentity {
  id: string
  provider: string
  session_id?: string
}

export interface GatewayRequestContext {
  profile: GatewayProfile
  request_id: string
  actor: AgentIdentity
  project_scope?: string
  timeout_ms: number
  idempotency_key?: string
  transport: 'mcp' | 'openapi'
}

export interface GatewayToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: any
  isError?: boolean
}

const legacyToolSources = [
  ...readOnlyMcpTools,
  ...safeWriteMcpTools,
  ...deliveryMcpTools,
  ...deploymentMcpTools,
  ...rollbackMcpTools,
  ...projectBrainMcpTools,
  ...missionMcpTools,
  ...missionExecutionMcpTools,
] as const

export const legacyGatewayTools: readonly GatewayTool[] = legacyToolSources as unknown as readonly GatewayTool[]
export const subscriptionGatewayTools: readonly GatewayTool[] = subscriptionMcpTools as unknown as readonly GatewayTool[]

const legacyToolMap = new Map(legacyGatewayTools.map((tool) => [tool.name, tool]))
const subscriptionToolMap = new Map(subscriptionGatewayTools.map((tool) => [tool.name, tool]))
const allKnownNames = new Set([...legacyToolMap.keys(), ...subscriptionToolMap.keys()])

const READ_ONLY_NAMES = new Set<string>(readOnlyMcpTools.map((tool) => tool.name))
const SAFE_WRITE_NAMES = new Set<string>(safeWriteMcpTools.map((tool) => tool.name))
const DELIVERY_NAMES = new Set<string>(deliveryMcpTools.map((tool) => tool.name))
const DEPLOYMENT_NAMES = new Set<string>(deploymentMcpTools.map((tool) => tool.name))
const ROLLBACK_NAMES = new Set<string>(rollbackMcpTools.map((tool) => tool.name))
const PROJECT_BRAIN_NAMES = new Set<string>(projectBrainMcpTools.map((tool) => tool.name))
const MISSION_NAMES = new Set<string>(missionMcpTools.map((tool) => tool.name))
const MISSION_EXECUTION_NAMES = new Set<string>(missionExecutionMcpTools.map((tool) => tool.name))

const IRREVERSIBLE_TOOLS = new Set([
  'repository_delete_branch',
])

const APPROVAL_REQUIRED_TOOLS = new Set([
  'repository_write_file',
  'repository_apply_patch',
  'repository_delete_file',
  'repository_commit',
  'repository_push',
  'repository_create_pull_request',
  'deployment_start',
  'rollback_request',
])

const PERMISSION_CLAIM_KEYS = new Set([
  'approved',
  'approval_granted',
  'authorization',
  'bearer',
  'permission',
  'permission_granted',
  'secret',
  'token',
])

const SECRET_KEY_PATTERN = /(authorization|bearer|credential|password|private[_-]?key|secret|token)/i
const SECRET_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=?\b/gi

export function classifyToolSafety(tool: GatewayTool): ToolSafetyClass {
  if (tool.annotations.readOnlyHint) return 'read-only'
  if (IRREVERSIBLE_TOOLS.has(tool.name)) return 'irreversible'
  if (APPROVAL_REQUIRED_TOOLS.has(tool.name)) return 'approval-required'
  return 'write-without-approval'
}

function withSafetyMetadata(tool: GatewayTool): GatewayTool {
  const safetyClass = classifyToolSafety(tool)
  return {
    ...tool,
    annotations: {
      ...tool.annotations,
      readOnlyHint: safetyClass === 'read-only',
      destructiveHint: safetyClass === 'irreversible' || Boolean(tool.annotations.destructiveHint),
      idempotentHint: Boolean(tool.annotations.idempotentHint),
      openWorldHint: Boolean(tool.annotations.openWorldHint),
    },
    _meta: {
      ...(tool._meta ?? {}),
      'bestcode/safetyClass': safetyClass,
      'bestcode/approvalAuthority': 'owner-only',
      'bestcode/promptIsPermission': false,
    },
  }
}

export function gatewayTools(profile: GatewayProfile): GatewayTool[] {
  const tools = profile === 'subscription-readonly' ? subscriptionGatewayTools : legacyGatewayTools
  return tools.map(withSafetyMetadata)
}

export function gatewayTool(profile: GatewayProfile, name: string): GatewayTool | undefined {
  const tool = profile === 'subscription-readonly'
    ? subscriptionToolMap.get(name)
    : legacyToolMap.get(name)
  return tool ? withSafetyMetadata(tool) : undefined
}

export function isKnownGatewayTool(name: string): boolean {
  return allKnownNames.has(name)
}

function safeHeaderValue(value: string | null, fallback: string, max = 160): string {
  if (!value) return fallback
  const trimmed = value.trim().slice(0, max)
  return /^[A-Za-z0-9._:@/-]+$/.test(trimmed) ? trimmed : fallback
}

function positiveInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
}

export function gatewayContextFromRequest(
  req: Request,
  profile: GatewayProfile,
  transport: GatewayRequestContext['transport'],
): GatewayRequestContext {
  const url = new URL(req.url)
  const requestId = safeHeaderValue(req.headers.get('X-BestCode-Request-Id'), crypto.randomUUID(), 128)
  const actorId = safeHeaderValue(req.headers.get('X-BestCode-Agent-Id') ?? url.searchParams.get('agent_id'), 'connected-agent')
  const provider = safeHeaderValue(req.headers.get('X-BestCode-Agent-Provider') ?? url.searchParams.get('agent_provider'), 'provider-neutral')
  const sessionId = safeHeaderValue(req.headers.get('X-BestCode-Agent-Session'), '', 160)
  const projectScope = safeHeaderValue(url.searchParams.get('project_id'), '', 64)
  const idempotencyKey = safeHeaderValue(req.headers.get('Idempotency-Key'), '', 128)

  return {
    profile,
    request_id: requestId,
    actor: {
      id: actorId,
      provider,
      ...(sessionId ? { session_id: sessionId } : {}),
    },
    ...(projectScope ? { project_scope: projectScope } : {}),
    timeout_ms: positiveInteger(req.headers.get('X-BestCode-Timeout-Ms'), 30_000, 1_000, 120_000),
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    transport,
  }
}

export function validateRepositoryPath(value: string): void {
  if (!value || value.length > 240 || value.includes('\\') || value.includes('\0')) {
    throw new Error('Repository path is invalid')
  }
  const normalized = value.replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Repository path traversal is not allowed')
  }
  if (segments[0].toLowerCase() === '.git') throw new Error('.git paths are not accessible')
}

function validateRepositoryArguments(args: Record<string, unknown>): void {
  if (typeof args.path === 'string') validateRepositoryPath(args.path)
  if (Array.isArray(args.paths)) {
    for (const path of args.paths) {
      if (typeof path !== 'string') throw new Error('Repository paths must be strings')
      validateRepositoryPath(path)
    }
  }
}

function validatePermissionClaims(args: Record<string, unknown>): void {
  for (const key of Object.keys(args)) {
    if (PERMISSION_CLAIM_KEYS.has(key.toLowerCase())) {
      throw new Error(`Tool argument ${key} cannot grant permission or approval`)
    }
  }
}

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[REDACTED:DEPTH_LIMIT]'
  if (typeof value === 'string') return value.replace(SECRET_VALUE_PATTERN, 'Bearer [REDACTED]')
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecrets(nested, depth + 1)
  }
  return output
}

function errorResult(
  code: string,
  message: string,
  actionRequired: string,
  context: GatewayRequestContext,
  toolName: string,
  safetyClass: ToolSafetyClass,
): GatewayToolResult {
  const structuredContent = {
    ok: false,
    operation_id: crypto.randomUUID(),
    status: 'failed',
    request_id: context.request_id,
    actor: context.actor,
    project_scope: context.project_scope ?? null,
    safety_class: safetyClass,
    idempotency: {
      provided: Boolean(context.idempotency_key),
      replayed: false,
      persisted: false,
    },
    audit: {
      event: 'bestcode_tool_execution',
      transport: context.transport,
      profile: context.profile,
      tool: toolName,
      outcome: 'denied',
    },
    error: {
      code,
      message,
      retryable: false,
      action_required: actionRequired,
    },
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  }
}

async function executeLegacyTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
  context: GatewayRequestContext,
): Promise<GatewayToolResult> {
  if (READ_ONLY_NAMES.has(name)) return executeReadOnlyMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (SAFE_WRITE_NAMES.has(name)) return executeSafeWriteMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (DELIVERY_NAMES.has(name)) return executeDeliveryMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (DEPLOYMENT_NAMES.has(name)) return executeDeploymentMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (ROLLBACK_NAMES.has(name)) return executeRollbackMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (PROJECT_BRAIN_NAMES.has(name)) return executeProjectBrainMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (MISSION_NAMES.has(name)) return executeMissionMcpTool(name, args, token, env) as Promise<GatewayToolResult>
  if (MISSION_EXECUTION_NAMES.has(name)) return executeMissionExecutionTool(name, args, env, context) as Promise<GatewayToolResult>
  throw new Error(`Unknown BestCode tool: ${name}`)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function addMetadata(
  result: GatewayToolResult,
  context: GatewayRequestContext,
  toolName: string,
  safetyClass: ToolSafetyClass,
  durationMs: number,
): GatewayToolResult {
  const redacted = redactSecrets(result.structuredContent) as Record<string, unknown>
  const structuredContent: Record<string, unknown> = {
    ...redacted,
    request_id: context.request_id,
    actor: context.actor,
    project_scope: context.project_scope ?? redacted.project_id ?? null,
    safety_class: safetyClass,
    idempotency: {
      provided: Boolean(context.idempotency_key),
      replayed: false,
      persisted: false,
    },
    audit: {
      event: 'bestcode_tool_execution',
      transport: context.transport,
      profile: context.profile,
      tool: toolName,
      outcome: redacted.ok === false ? 'failed' : 'completed',
      duration_ms: durationMs,
    },
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(result.isError || structuredContent.ok === false ? { isError: true } : {}),
  }
}

export async function executeGatewayTool(
  profile: GatewayProfile,
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
  context: GatewayRequestContext,
): Promise<GatewayToolResult> {
  const selectedTool = gatewayTool(profile, name)
  const knownTool = legacyToolMap.get(name) ?? subscriptionToolMap.get(name)
  const safetyClass = classifyToolSafety(selectedTool ?? knownTool ?? {
    name,
    title: name,
    description: '',
    inputSchema: {},
    annotations: {},
  })

  if (!selectedTool) {
    return errorResult(
      isKnownGatewayTool(name) ? 'TOOL_DISABLED_FOR_PROFILE' : 'UNKNOWN_TOOL',
      isKnownGatewayTool(name)
        ? `Tool ${name} is disabled for ${profile}.`
        : `Unknown BestCode tool: ${name}`,
      profile === 'subscription-readonly'
        ? 'Use tools/list. Subscription gateways expose read-only tools only.'
        : 'Use tools/list and call an advertised tool.',
      context,
      name,
      safetyClass,
    )
  }

  if (profile === 'subscription-readonly' && safetyClass !== 'read-only') {
    return errorResult(
      'MUTATION_DISABLED',
      `Tool ${name} is not read-only.`,
      'Use the BestCode owner approval workflow on a mutation-enabled surface.',
      context,
      name,
      safetyClass,
    )
  }

  if (profile === 'subscription-readonly' && !context.project_scope) {
    return errorResult(
      'PROJECT_SCOPE_REQUIRED',
      'Subscription MCP requires project_id in the gateway URL.',
      'Configure the remote MCP URL with ?project_id=<allowed-project-id>.',
      context,
      name,
      safetyClass,
    )
  }

  try {
    validateRepositoryArguments(args)
    if (profile === 'subscription-readonly') validatePermissionClaims(args)

    if (
      profile === 'subscription-readonly' &&
      name !== 'projects_list' &&
      args.project_id !== context.project_scope
    ) {
      return errorResult(
        'CROSS_PROJECT_ACCESS_DENIED',
        `Tool project_id must match gateway scope ${context.project_scope}.`,
        'Use projects_list and the project_id bound to this gateway URL.',
        context,
        name,
        safetyClass,
      )
    }

    const startedAt = Date.now()
    const result = await withTimeout(
      profile === 'subscription-readonly'
        ? executeSubscriptionTool(name, args, token, env, context.project_scope!)
        : executeLegacyTool(name, args, token, env, context),
      context.timeout_ms,
    )
    return addMetadata(result, context, name, safetyClass, Date.now() - startedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = /timed out/i.test(message)
      ? 'TOOL_TIMEOUT'
      : /traversal|\.git paths|Repository path/i.test(message)
        ? 'INVALID_REPOSITORY_PATH'
        : /permission|approval/i.test(message)
          ? 'PROMPT_IS_NOT_PERMISSION'
          : 'GATEWAY_EXECUTION_FAILED'
    return errorResult(
      code,
      message,
      code === 'TOOL_TIMEOUT'
        ? 'Retry with a smaller read request or a larger bounded timeout.'
        : 'Correct the request without changing project scope or safety policy.',
      context,
      name,
      safetyClass,
    )
  }
}
