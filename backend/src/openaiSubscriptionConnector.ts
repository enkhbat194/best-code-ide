import { subscriptionToolNames } from './subscriptionTools'
import { MAX_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS } from './subscriptionCredentialTypes'

export const OPENAI_SUBSCRIPTION_CONNECTOR_SCHEMA_VERSION = 'bestcode-openai-subscription-connector-v1' as const
export const OPENAI_SUBSCRIPTION_PROVIDER = 'openai' as const
export const OPENAI_SUBSCRIPTION_AGENT_NAME = 'chatgpt-codex' as const
export const OPENAI_SUBSCRIPTION_TOKEN_ENV_VAR = 'BESTCODE_OPENAI_SUBSCRIPTION_TOKEN' as const
export const OPENAI_SUBSCRIPTION_APPROVAL_MODE = 'writes' as const

export const OPENAI_SUPPORTED_MCP_SURFACES = [
  'codex-cli',
  'codex-ide',
  'chatgpt-desktop',
] as const

export type OpenAiSupportedMcpSurface = typeof OPENAI_SUPPORTED_MCP_SURFACES[number]

export interface OpenAiSubscriptionConnectorConfig {
  schema_version: typeof OPENAI_SUBSCRIPTION_CONNECTOR_SCHEMA_VERSION
  provider: typeof OPENAI_SUBSCRIPTION_PROVIDER
  surface: OpenAiSupportedMcpSurface
  server_url: string
  project_id: string
  agent: {
    name: string
    provider: typeof OPENAI_SUBSCRIPTION_PROVIDER
  }
  authorization: {
    method: 'bearer_env'
    header: 'Authorization'
    scheme: 'Bearer'
    bearer_token_env_var: typeof OPENAI_SUBSCRIPTION_TOKEN_ENV_VAR
  }
  allowed_tools: string[]
  approval_mode: typeof OPENAI_SUBSCRIPTION_APPROVAL_MODE
  credential: {
    expires_at: string
    rotation: 'create-new-then-revoke-old'
  }
  connection_test: {
    initialize: true
    tools_list: true
    smoke_tool: 'project_get'
    audit_event: 'mcp_tool_call'
  }
  revoke: {
    method: 'POST'
    owner_path: '/api/subscription/credentials/{credential_id}/revoke'
  }
}

const scopedSecretPattern = /\bbcsub_v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{32,128}\b/i
const identifierPattern = /^[A-Za-z0-9._:@/-]+$/

function assertNoRawCredential(value: unknown): void {
  if (scopedSecretPattern.test(JSON.stringify(value))) {
    throw new Error('Raw scoped credential must not appear in connector configuration')
  }
}

function requireIdentifier(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  const clean = value.trim()
  if (clean.length > max || !identifierPattern.test(clean)) throw new Error(`${name} is invalid`)
  return clean
}

function timestamp(value: unknown, name: string): number {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an ISO timestamp`)
  return parsed
}

function validateServerUrl(value: unknown, projectId: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('server_url is required')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('server_url must be a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('server_url must use HTTPS')
  if (url.username || url.password || url.hash) throw new Error('server_url must not contain credentials or a fragment')
  if (url.pathname !== '/mcp/subscription') throw new Error('server_url must target /mcp/subscription')
  const projectValues = url.searchParams.getAll('project_id')
  const keys = [...url.searchParams.keys()]
  if (keys.length !== 1 || keys[0] !== 'project_id' || projectValues.length !== 1 || projectValues[0] !== projectId) {
    throw new Error('server_url must contain only the authoritative project_id query parameter')
  }
  return url.toString()
}

function validateExactTools(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('allowed_tools must be a string array')
  }
  const expected = [...subscriptionToolNames]
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error('allowed_tools must equal the locked subscription-readonly-v1 tool set')
  }
  return [...value]
}

export function validateOpenAiSubscriptionConnectorConfig(
  value: OpenAiSubscriptionConnectorConfig,
  now = new Date().toISOString(),
): OpenAiSubscriptionConnectorConfig {
  assertNoRawCredential(value)
  if (!value || typeof value !== 'object') throw new Error('connector configuration is required')
  if (value.schema_version !== OPENAI_SUBSCRIPTION_CONNECTOR_SCHEMA_VERSION) throw new Error('schema_version is unsupported')
  if (value.provider !== OPENAI_SUBSCRIPTION_PROVIDER) throw new Error('provider must equal openai')
  if (!OPENAI_SUPPORTED_MCP_SURFACES.includes(value.surface)) {
    throw new Error('surface must be codex-cli, codex-ide, or chatgpt-desktop')
  }

  const projectId = requireIdentifier(value.project_id, 'project_id', 64)
  const agentName = requireIdentifier(value.agent?.name, 'agent.name', 160)
  if (value.agent?.provider !== OPENAI_SUBSCRIPTION_PROVIDER) throw new Error('agent.provider must equal openai')
  const serverUrl = validateServerUrl(value.server_url, projectId)

  if (
    value.authorization?.method !== 'bearer_env' ||
    value.authorization?.header !== 'Authorization' ||
    value.authorization?.scheme !== 'Bearer' ||
    value.authorization?.bearer_token_env_var !== OPENAI_SUBSCRIPTION_TOKEN_ENV_VAR
  ) {
    throw new Error('authorization must use Authorization Bearer from BESTCODE_OPENAI_SUBSCRIPTION_TOKEN')
  }

  const allowedTools = validateExactTools(value.allowed_tools)
  if (value.approval_mode !== OPENAI_SUBSCRIPTION_APPROVAL_MODE) {
    throw new Error('approval_mode must equal writes')
  }

  const nowMs = timestamp(now, 'now')
  const expiresAtMs = timestamp(value.credential?.expires_at, 'credential.expires_at')
  if (expiresAtMs <= nowMs) throw new Error('credential.expires_at must be in the future')
  if (expiresAtMs - nowMs > MAX_SUBSCRIPTION_CREDENTIAL_TTL_SECONDS * 1000) {
    throw new Error('credential.expires_at exceeds the maximum scoped credential lifetime')
  }
  if (value.credential?.rotation !== 'create-new-then-revoke-old') throw new Error('credential rotation contract is invalid')

  if (
    value.connection_test?.initialize !== true ||
    value.connection_test?.tools_list !== true ||
    value.connection_test?.smoke_tool !== 'project_get' ||
    value.connection_test?.audit_event !== 'mcp_tool_call'
  ) {
    throw new Error('connection_test contract is invalid')
  }
  if (value.revoke?.method !== 'POST' || value.revoke?.owner_path !== '/api/subscription/credentials/{credential_id}/revoke') {
    throw new Error('revoke contract is invalid')
  }

  return {
    ...value,
    server_url: serverUrl,
    project_id: projectId,
    agent: { name: agentName, provider: OPENAI_SUBSCRIPTION_PROVIDER },
    allowed_tools: allowedTools,
  }
}

export function buildOpenAiSubscriptionConnectorConfig(input: {
  backend_url: string
  project_id: string
  expires_at: string
  surface?: OpenAiSupportedMcpSurface
  agent_name?: string
  now?: string
}): OpenAiSubscriptionConnectorConfig {
  const base = new URL(input.backend_url)
  const endpoint = new URL('/mcp/subscription', base)
  endpoint.searchParams.set('project_id', input.project_id)
  return validateOpenAiSubscriptionConnectorConfig({
    schema_version: OPENAI_SUBSCRIPTION_CONNECTOR_SCHEMA_VERSION,
    provider: OPENAI_SUBSCRIPTION_PROVIDER,
    surface: input.surface ?? 'codex-cli',
    server_url: endpoint.toString(),
    project_id: input.project_id,
    agent: {
      name: input.agent_name ?? OPENAI_SUBSCRIPTION_AGENT_NAME,
      provider: OPENAI_SUBSCRIPTION_PROVIDER,
    },
    authorization: {
      method: 'bearer_env',
      header: 'Authorization',
      scheme: 'Bearer',
      bearer_token_env_var: OPENAI_SUBSCRIPTION_TOKEN_ENV_VAR,
    },
    allowed_tools: [...subscriptionToolNames],
    approval_mode: OPENAI_SUBSCRIPTION_APPROVAL_MODE,
    credential: {
      expires_at: input.expires_at,
      rotation: 'create-new-then-revoke-old',
    },
    connection_test: {
      initialize: true,
      tools_list: true,
      smoke_tool: 'project_get',
      audit_event: 'mcp_tool_call',
    },
    revoke: {
      method: 'POST',
      owner_path: '/api/subscription/credentials/{credential_id}/revoke',
    },
  }, input.now)
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

export function buildCodexMcpToml(config: OpenAiSubscriptionConnectorConfig, now = new Date().toISOString()): string {
  const checked = validateOpenAiSubscriptionConnectorConfig(config, now)
  const tools = checked.allowed_tools.map(tomlString).join(', ')
  const result = [
    '[mcp_servers.bestcode]',
    `url = ${tomlString(checked.server_url)}`,
    `bearer_token_env_var = ${tomlString(checked.authorization.bearer_token_env_var)}`,
    `enabled_tools = [${tools}]`,
    `default_tools_approval_mode = ${tomlString(checked.approval_mode)}`,
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 45',
    'enabled = true',
    '',
  ].join('\n')
  assertNoRawCredential(result)
  return result
}
