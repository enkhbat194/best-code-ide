import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MCP_PROTOCOL_VERSION,
  MUTATION_TOOLS,
  REQUIRED_SUBSCRIPTION_TOOLS,
  assertNoSecretLeak,
  runMcpProductionSmoke,
} from './mcp-production-smoke.mjs'

const TOKEN = 'production-test-token-value'
const SHA = '8085741f4877caa32e25ebb61267f63814ba51fe'
const HASH = 'a'.repeat(64)

function tool(name) {
  return {
    name,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { 'bestcode/safetyClass': 'read-only' },
  }
}

function result(id, requestId, name, structuredContent) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent: {
        ...structuredContent,
        request_id: requestId,
        project_scope: 'bestcode',
        audit: {
          event: 'bestcode_tool_execution',
          profile: 'subscription-readonly',
          transport: 'mcp',
          tool: name,
          outcome: structuredContent.ok === false ? 'denied' : 'completed',
        },
      },
      ...(structuredContent.ok === false ? { isError: true } : {}),
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeFetch() {
  return async (url, init) => {
    assert.equal(new URL(url).pathname, '/mcp/subscription')
    assert.equal(new URL(url).searchParams.get('project_id'), 'bestcode')
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
    const request = JSON.parse(init.body)
    const requestId = init.headers['X-BestCode-Request-Id']

    if (request.method === 'initialize') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'bestcode-subscription-agent-gateway' },
        },
      }), { status: 200 })
    }
    if (request.method === 'tools/list') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: REQUIRED_SUBSCRIPTION_TOOLS.map(tool) },
      }), { status: 200 })
    }

    const name = request.params.name
    const args = request.params.arguments
    if (name === 'project_get' && args.project_id === 'bestcode') {
      return result(request.id, requestId, name, {
        ok: true,
        operation_id: crypto.randomUUID(),
        status: 'completed',
        safety_class: 'read-only',
        project_id: 'bestcode',
        result: { project: { id: 'bestcode' } },
      })
    }
    if (name === 'project_get') {
      return result(request.id, requestId, name, {
        ok: false,
        operation_id: crypto.randomUUID(),
        status: 'failed',
        safety_class: 'read-only',
        error: { code: 'CROSS_PROJECT_ACCESS_DENIED' },
      })
    }
    if (name === 'repository_read_file') {
      return result(request.id, requestId, name, {
        ok: false,
        operation_id: crypto.randomUUID(),
        status: 'failed',
        safety_class: 'read-only',
        error: { code: 'INVALID_REPOSITORY_PATH' },
      })
    }
    if (name === 'repository_create_branch') {
      return result(request.id, requestId, name, {
        ok: false,
        operation_id: crypto.randomUUID(),
        status: 'failed',
        safety_class: 'write-without-approval',
        error: { code: 'TOOL_DISABLED_FOR_PROFILE' },
      })
    }
    if (name === 'handoff_packet_build') {
      return result(request.id, requestId, name, {
        ok: true,
        operation_id: crypto.randomUUID(),
        status: 'completed',
        safety_class: 'read-only',
        result: {
          packet: {
            schema_version: 'bestcode-handoff-packet-v1',
            project_id: 'bestcode',
            mission_id: null,
            repository: 'enkhbat194/best-code-ide',
            base_sha: SHA,
            branch: 'main',
            objective: args.objective,
            completed_work: args.completed_work,
            changed_files: [],
            test_status: args.test_status,
            unresolved_issues: [],
            decisions_required: [],
            safety_constraints: args.safety_constraints,
            next_exact_action: args.next_exact_action,
            source_references: args.source_references,
            evidence_references: args.evidence_references,
            packet_hash: HASH,
          },
        },
      })
    }
    throw new Error(`Unexpected tool: ${name}`)
  }
}

test('authenticated subscription smoke verifies the exact read-only contract without persisting secrets', async () => {
  const evidence = await runMcpProductionSmoke({
    backendUrl: 'https://best-code-ide.example',
    token: TOKEN,
    expectedSha: SHA,
    fetchImpl: fakeFetch(),
    checkedAt: '2026-07-24T00:00:00.000Z',
  })
  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.scope.commit_sha, SHA)
  assert.deepEqual(evidence.tools.advertised, REQUIRED_SUBSCRIPTION_TOOLS)
  assert.equal(evidence.tools.mutation_tools_advertised.length, 0)
  assert.equal(evidence.tools.direct_mutation_call_denied, true)
  assert.deepEqual(evidence.checks.path_traversal_fail_closed, ['INVALID_REPOSITORY_PATH', 'INVALID_REPOSITORY_PATH'])
  assert.equal(evidence.checks.handoff_packet_hash, HASH)
  assert.equal(JSON.stringify(evidence).includes(TOKEN), false)
})

test('secret leak detector rejects exact tokens and unredacted Bearer values', () => {
  assert.throws(() => assertNoSecretLeak(`value=${TOKEN}`, TOKEN), /authentication secret/)
  assert.throws(() => assertNoSecretLeak('Authorization: Bearer abcdefghijklmnop', TOKEN), /unredacted Bearer/)
  assert.doesNotThrow(() => assertNoSecretLeak('Authorization: Bearer [REDACTED]', TOKEN))
})

test('locked read-only and mutation sets do not overlap', () => {
  assert.equal(REQUIRED_SUBSCRIPTION_TOOLS.some((name) => MUTATION_TOOLS.includes(name)), false)
  assert.equal(new Set(REQUIRED_SUBSCRIPTION_TOOLS).size, REQUIRED_SUBSCRIPTION_TOOLS.length)
})
