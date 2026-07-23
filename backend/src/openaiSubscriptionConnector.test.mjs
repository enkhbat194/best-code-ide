import assert from 'node:assert/strict'
import test from 'node:test'

import { handleMcp } from './mcp.ts'
import {
  OPENAI_SUBSCRIPTION_TOKEN_ENV_VAR,
  buildCodexMcpToml,
  buildOpenAiSubscriptionConnectorConfig,
  validateOpenAiSubscriptionConnectorConfig,
} from './openaiSubscriptionConnector.ts'
import { SUBSCRIPTION_PROFILE, SUBSCRIPTION_TOOL_SET_VERSION } from './subscriptionCredentialTypes.ts'
import { subscriptionToolNames } from './subscriptionTools.ts'
import { gatewayTools } from './toolGateway.ts'

const now = '2026-07-24T00:00:00.000Z'
const expiresAt = '2026-07-24T00:15:00.000Z'

function connector(overrides = {}) {
  return {
    ...buildOpenAiSubscriptionConnectorConfig({
      backend_url: 'https://best-code-ide.enkhbat194.workers.dev',
      project_id: 'bestcode',
      expires_at: expiresAt,
      now,
    }),
    ...overrides,
  }
}

function mcpRequest(body) {
  return new Request('https://bestcode.example/mcp/subscription?project_id=bestcode', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      'X-BestCode-Agent-Id': 'spoofed-agent',
      'X-BestCode-Agent-Provider': 'spoofed-provider',
    },
    body: JSON.stringify(body),
  })
}

const principal = {
  kind: 'subscription',
  credential_id: '11111111-1111-1111-1111-111111111111',
  project_id: 'bestcode',
  agent_id: 'chatgpt-codex',
  provider: 'openai',
  profile: SUBSCRIPTION_PROFILE,
  tool_set_version: SUBSCRIPTION_TOOL_SET_VERSION,
  allowed_tools: [...subscriptionToolNames],
  credential_version: 1,
  issued_at: now,
  expires_at: expiresAt,
}

const env = {
  GITHUB_TOKEN: 'test-github-token',
  PROJECTS_JSON: JSON.stringify([
    { id: 'bestcode', name: 'BestCode', owner: 'enkhbat194', repo: 'best-code-ide', defaultBranch: 'main' },
  ]),
}

test('OpenAI connector contract locks provider, URL, identity, expiry, and exact tools', () => {
  const config = connector()
  const checked = validateOpenAiSubscriptionConnectorConfig(config, now)
  assert.equal(checked.provider, 'openai')
  assert.equal(checked.surface, 'codex-cli')
  assert.equal(checked.agent.name, 'chatgpt-codex')
  assert.equal(checked.authorization.bearer_token_env_var, OPENAI_SUBSCRIPTION_TOKEN_ENV_VAR)
  assert.deepEqual(checked.allowed_tools, subscriptionToolNames)
  assert.equal(checked.approval_mode, 'writes')
  const url = new URL(checked.server_url)
  assert.equal(url.pathname, '/mcp/subscription')
  assert.equal(url.searchParams.get('project_id'), 'bestcode')
})

test('unsupported OpenAI surfaces and widening configuration fail closed', () => {
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig(connector({ surface: 'chatgpt-web' }), now), /surface/)
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig(connector({ provider: 'anthropic' }), now), /provider/)
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig(connector({
    server_url: 'https://bestcode.example/mcp?project_id=bestcode',
  }), now), /mcp\/subscription/)
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig(connector({
    server_url: 'https://bestcode.example/mcp/subscription?project_id=bestcode&key=secret',
  }), now), /only the authoritative project_id/)
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig(connector({
    allowed_tools: [...subscriptionToolNames, 'repository_create_branch'],
  }), now), /locked/)
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig(connector({
    credential: { expires_at: '2026-08-24T00:00:01.000Z', rotation: 'create-new-then-revoke-old' },
  }), now), /maximum/)
})

test('raw scoped credentials are rejected and never rendered into Codex config', () => {
  const token = `bcsub_v1.11111111-1111-1111-1111-111111111111.${'x'.repeat(43)}`
  assert.throws(() => validateOpenAiSubscriptionConnectorConfig({ ...connector(), accidental_secret: token }, now), /Raw scoped credential/)
  const toml = buildCodexMcpToml(connector(), now)
  assert.match(toml, /bearer_token_env_var = "BESTCODE_OPENAI_SUBSCRIPTION_TOKEN"/)
  assert.match(toml, /default_tools_approval_mode = "writes"/)
  assert.equal(toml.includes(token), false)
  for (const name of subscriptionToolNames) assert.match(toml, new RegExp(`"${name}"`))
})

test('OpenAI discovers exactly twelve compatible read-only schemas', () => {
  const tools = gatewayTools('subscription-readonly')
  assert.deepEqual(tools.map((tool) => tool.name), subscriptionToolNames)
  assert.equal(tools.length, 12)
  for (const tool of tools) {
    assert.equal(typeof tool.title, 'string')
    assert.ok(tool.title.length > 0)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 0)
    assert.equal(tool.inputSchema.type, 'object')
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.equal(tool.outputSchema?.type, 'object')
    assert.deepEqual(tool.outputSchema?.required, ['ok', 'operation_id', 'status'])
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.annotations.destructiveHint, false)
    assert.equal(tool.annotations.idempotentHint, true)
    assert.equal(tool._meta['bestcode/safetyClass'], 'read-only')
    assert.equal(tool._meta['bestcode/promptIsPermission'], false)
  }
})

test('OpenAI MCP initialize and tools/list retain the locked profile', async () => {
  const initialized = await handleMcp(mcpRequest({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'codex', version: '1.0.0' },
    },
  }), env, principal)
  const initializeBody = await initialized.json()
  assert.equal(initializeBody.result.serverInfo.name, 'bestcode-subscription-agent-gateway')
  assert.match(initializeBody.result.instructions, /cannot mutate/)

  const listed = await handleMcp(mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), env, principal)
  const listBody = await listed.json()
  assert.deepEqual(listBody.result.tools.map((tool) => tool.name), subscriptionToolNames)
})

test('project_get returns structured OpenAI-compatible content with authoritative audit identity', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/repos/enkhbat194/best-code-ide')
    return new Response(JSON.stringify({
      full_name: 'enkhbat194/best-code-ide',
      default_branch: 'main',
      private: false,
      archived: false,
      html_url: 'https://github.com/enkhbat194/best-code-ide',
      updated_at: '2026-07-24T00:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const response = await handleMcp(mcpRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'project_get', arguments: { project_id: 'bestcode' },
      },
    }), env, principal)
    const body = await response.json()
    const result = body.result
    assert.equal(result.structuredContent.ok, true)
    assert.equal(result.structuredContent.actor.id, 'chatgpt-codex')
    assert.equal(result.structuredContent.actor.provider, 'openai')
    assert.equal(result.structuredContent.audit.credential_id, principal.credential_id)
    assert.equal(result.structuredContent.audit.project_id, 'bestcode')
    assert.equal(result.structuredContent.audit.provider, 'openai')
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent)
    assert.equal(JSON.stringify(result).includes('spoofed-provider'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
