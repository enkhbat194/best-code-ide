import assert from 'node:assert/strict'
import test from 'node:test'

import { isAuthorized } from './index.ts'
import { handleMcp } from './mcp.ts'
import { openapiSpec } from './openapi.ts'
import {
  classifyToolSafety,
  gatewayTool,
  gatewayTools,
  legacyGatewayTools,
  redactSecrets,
  validateRepositoryPath,
} from './toolGateway.ts'
import {
  buildHandoffPacket,
  normalizeRepositoryPath,
  subscriptionToolNames,
} from './subscriptionTools.ts'

const projects = JSON.stringify([
  {
    id: 'bestcode',
    name: 'BestCode',
    owner: 'enkhbat194',
    repo: 'best-code-ide',
    defaultBranch: 'main',
  },
  {
    id: 'czech-app',
    name: 'Czech app',
    owner: 'enkhbat194',
    repo: 'czech-mongolian-app',
    defaultBranch: 'main',
  },
])

const env = {
  GITHUB_TOKEN: 'test-github-token',
  AUTH_TOKEN: 'test-auth-token',
  PROJECTS_JSON: projects,
}

function mcpRequest(body, path = '/mcp/subscription?project_id=bestcode&agent_id=codex&agent_provider=openai') {
  return new Request(`https://bestcode.example${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      'X-BestCode-Request-Id': 'request-test-0001',
    },
    body: JSON.stringify(body),
  })
}

async function rpc(body, path) {
  const response = await handleMcp(mcpRequest(body, path), env)
  assert.equal(response.status, 200)
  return response.json()
}

test('MCP initialize negotiates the current stable protocol and subscription capabilities', async () => {
  const body = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'foundation-test', version: '1.0.0' },
    },
  })
  assert.equal(body.result.protocolVersion, '2025-11-25')
  assert.equal(body.result.capabilities.tools.listChanged, false)
  assert.equal(body.result.serverInfo.name, 'bestcode-subscription-agent-gateway')
})

test('subscription tools/list exposes only the locked read-only foundation', async () => {
  const body = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const names = body.result.tools.map((tool) => tool.name)
  assert.deepEqual(names, subscriptionToolNames)
  for (const tool of body.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool._meta['bestcode/safetyClass'], 'read-only')
  }
})

test('Bearer and query-key authentication use the same owner secret', async () => {
  assert.equal(await isAuthorized(
    new Request('https://bestcode.example/mcp', { headers: { Authorization: 'Bearer test-auth-token' } }),
    env,
  ), true)
  assert.equal(await isAuthorized(
    new Request('https://bestcode.example/mcp?key=test-auth-token'),
    env,
  ), true)
  assert.equal(await isAuthorized(
    new Request('https://bestcode.example/mcp', { headers: { Authorization: 'Bearer wrong' } }),
    env,
  ), false)
})

test('subscription gateway denies cross-project access before upstream execution', async () => {
  const body = await rpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'project_get', arguments: { project_id: 'czech-app' } },
  })
  assert.equal(body.result.isError, true)
  assert.equal(body.result.structuredContent.error.code, 'CROSS_PROJECT_ACCESS_DENIED')
})

test('subscription gateway denies approval-required mutation tools', async () => {
  const body = await rpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'repository_create_branch',
      arguments: { project_id: 'bestcode', name: 'agent/forbidden' },
    },
  })
  assert.equal(body.result.isError, true)
  assert.equal(body.result.structuredContent.error.code, 'TOOL_DISABLED_FOR_PROFILE')
})

test('repository path traversal is rejected consistently', async () => {
  assert.throws(() => validateRepositoryPath('../secret.txt'), /traversal/)
  assert.throws(() => normalizeRepositoryPath('docs/../secret.txt'), /traversal/)
  const body = await rpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'repository_read_file',
      arguments: { project_id: 'bestcode', path: '../secret.txt' },
    },
  })
  assert.equal(body.result.structuredContent.error.code, 'INVALID_REPOSITORY_PATH')
})

test('secret redaction removes secret keys and Bearer values', () => {
  const redacted = redactSecrets({
    token: 'plain-secret',
    nested: {
      Authorization: 'Bearer abcdefghijklmnop',
      safe: 'visible',
    },
  })
  assert.deepEqual(redacted, {
    token: '[REDACTED]',
    nested: {
      Authorization: '[REDACTED]',
      safe: 'visible',
    },
  })
})

test('handoff packet is deterministic and provider-neutral', async () => {
  const input = {
    project_id: 'bestcode',
    mission_id: '11111111-1111-1111-1111-111111111111',
    repository: 'enkhbat194/best-code-ide',
    base_sha: 'b7c5328531506b94a71934c6abb7aa7408b9bae6',
    branch: 'agent/subscription-mcp-gateway-foundation',
    objective: 'Create the subscription MCP foundation.',
    completed_work: ['Added a shared tool gateway.'],
    changed_files: [{ path: 'backend/src/toolGateway.ts', status: 'added' }],
    test_status: {
      state: 'passed',
      summary: 'Foundation tests passed.',
      evidence_references: ['ci:test'],
    },
    unresolved_issues: [],
    decisions_required: [],
    safety_constraints: ['No autonomous merge or deploy.'],
    next_exact_action: 'Open a draft pull request.',
    source_references: ['main:b7c53285'],
    evidence_references: ['ci:test'],
  }
  const first = await buildHandoffPacket(input)
  const second = await buildHandoffPacket(structuredClone(input))
  assert.deepEqual(first, second)
  assert.equal(first.schema_version, 'bestcode-handoff-packet-v1')
  assert.equal(typeof first.packet_hash, 'string')
  assert.equal(JSON.stringify(first).includes('openai'), false)
  assert.equal(JSON.stringify(first).includes('anthropic'), false)
})

test('legacy OpenAPI Actions and MCP use the same tool registry', () => {
  const spec = openapiSpec('https://bestcode.example')
  const operationNames = Object.values(spec.paths).map((path) => path.post.operationId).sort()
  assert.deepEqual(operationNames, legacyGatewayTools.map((tool) => tool.name).sort())
  assert.deepEqual(
    gatewayTools('legacy').map((tool) => tool.name),
    legacyGatewayTools.map((tool) => tool.name),
  )
})

test('all four BestCode safety classes are represented and stable', () => {
  assert.equal(classifyToolSafety(gatewayTool('legacy', 'project_get')), 'read-only')
  assert.equal(classifyToolSafety(gatewayTool('legacy', 'repository_create_branch')), 'write-without-approval')
  assert.equal(classifyToolSafety(gatewayTool('legacy', 'repository_write_file')), 'approval-required')
  assert.equal(classifyToolSafety(gatewayTool('legacy', 'repository_delete_branch')), 'irreversible')
})
