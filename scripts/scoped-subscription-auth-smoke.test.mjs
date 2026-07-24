import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_TOOLS, assertNoScopedSecret, runScopedSubscriptionAuthSmoke } from './scoped-subscription-auth-smoke.mjs'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeProduction({ agentName, provider, failTool = '' }) {
  const token = `bcsub_v1.11111111-1111-1111-1111-111111111111.${'x'.repeat(43)}`
  const staleId = '33333333-3333-3333-3333-333333333333'
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, project: url.searchParams.get('project_id'), authorization: init.headers?.Authorization })
    if (url.pathname === '/api/subscription/credentials' && init.method === 'GET') {
      if (init.headers?.Authorization === 'Bearer owner-secret') {
        return response({ items: [{
          credential_id: staleId,
          project_id: 'bestcode',
          subject_agent_id: agentName,
          agent_provider: provider,
          status: 'active',
        }] })
      }
      return response({ error: 'Unauthorized' }, 401)
    }
    if (url.pathname === '/api/subscription/credentials' && init.method === 'POST') {
      return response({ credential: { credential_id: '11111111-1111-1111-1111-111111111111' }, secret: token }, 201)
    }
    if (url.pathname.endsWith('/revoke')) return response({ credential: { status: 'revoked' } })
    if (url.pathname === '/mcp' || url.searchParams.get('project_id') === 'bestcode-wrong') return response({ error: 'Unauthorized' }, 401)
    const request = JSON.parse(init.body)
    if (request.method === 'initialize') {
      const currentRevoked = calls.some((call) => call.path === '/api/subscription/credentials/11111111-1111-1111-1111-111111111111/revoke')
      return currentRevoked ? response({ error: 'Unauthorized' }, 401) : response({
        jsonrpc: '2.0', id: request.id, result: { serverInfo: { name: 'bestcode-subscription-agent-gateway' } },
      })
    }
    if (request.method === 'tools/list') {
      return response({ jsonrpc: '2.0', id: request.id, result: { tools: REQUIRED_TOOLS.map((name) => ({
        name,
        annotations: { readOnlyHint: true },
        _meta: { 'bestcode/safetyClass': 'read-only' },
      })) } })
    }
    if (request.params.name === failTool) {
      return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: {
        ok: false, error: { code: 'SIMULATED_FAILURE' },
      } } })
    }
    if (request.params.name === 'project_get') {
      return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: {
        ok: true,
        actor: { id: agentName, provider },
        audit: {
          credential_id: '11111111-1111-1111-1111-111111111111',
          project_id: 'bestcode',
          agent_id: agentName,
          provider,
          mcp_profile: 'subscription-readonly',
        },
      } } })
    }
    if (request.params.name === 'brain_export_summary') {
      return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: {
        ok: true, result: { current_mission: { mission_id: '22222222-2222-2222-2222-222222222222' } },
      } } })
    }
    if (request.params.name === 'mission_context_get' || request.params.name === 'repository_status') {
      return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: { ok: true, result: {} } } })
    }
    return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: { error: { code: 'TOOL_DISABLED_FOR_PROFILE' } } } })
  }
  return { token, staleId, calls, fetchImpl }
}

test('controller cleans stale smoke credentials, keeps the scoped secret out of evidence, and revokes the new credential', async () => {
  const fake = fakeProduction({ agentName: 'github-actions-scoped-smoke', provider: 'provider-neutral' })
  const evidence = await runScopedSubscriptionAuthSmoke({
    backendUrl: 'https://bestcode.example', ownerToken: 'owner-secret', fetchImpl: fake.fetchImpl,
  })
  assert.equal(evidence.status, 'passed')
  assert.equal(evidence.stale_smoke_credentials_revoked, 1)
  assert.equal(JSON.stringify(evidence).includes(fake.token), false)
  assert.ok(evidence.checks.includes('stale_credential_cleanup'))
  assert.ok(evidence.checks.includes('owner_endpoint_denied'))
  assert.ok(evidence.checks.includes('credential_revoked'))
  assert.ok(evidence.checks.includes('revoked_denied'))
  assert.ok(fake.calls.some((call) => call.path === `/api/subscription/credentials/${fake.staleId}/revoke`))
  assertNoScopedSecret(evidence)
})

test('OpenAI closeout profile reads Brain, Mission, and repository status with authoritative identity', async () => {
  const fake = fakeProduction({ agentName: 'github-actions-openai-mcp-smoke', provider: 'openai' })
  const evidence = await runScopedSubscriptionAuthSmoke({
    backendUrl: 'https://bestcode.example',
    ownerToken: 'owner-secret',
    agentName: 'github-actions-openai-mcp-smoke',
    provider: 'openai',
    includeOpenAiReads: true,
    evidenceSchemaVersion: 'bestcode-openai-subscription-mcp-smoke-v1',
    fetchImpl: fake.fetchImpl,
  })
  assert.equal(evidence.schema_version, 'bestcode-openai-subscription-mcp-smoke-v1')
  assert.equal(evidence.provider, 'openai')
  assert.equal(evidence.agent_id, 'github-actions-openai-mcp-smoke')
  for (const check of [
    'brain_export_summary', 'mission_context_get', 'repository_status',
    'wrong_project_denied', 'full_endpoint_denied', 'mutation_denied',
  ]) assert.ok(evidence.checks.includes(check))
  assertNoScopedSecret(evidence)
})

test('failure evidence names the stage, contains no scoped secret, and confirms revocation', async () => {
  const fake = fakeProduction({
    agentName: 'github-actions-openai-mcp-smoke',
    provider: 'openai',
    failTool: 'brain_export_summary',
  })
  await assert.rejects(
    runScopedSubscriptionAuthSmoke({
      backendUrl: 'https://bestcode.example',
      ownerToken: 'owner-secret',
      agentName: 'github-actions-openai-mcp-smoke',
      provider: 'openai',
      includeOpenAiReads: true,
      evidenceSchemaVersion: 'bestcode-openai-subscription-mcp-smoke-v1',
      fetchImpl: fake.fetchImpl,
    }),
    (error) => {
      assert.equal(error.evidence.status, 'failed')
      assert.equal(error.evidence.failed_stage, 'brain_export_summary')
      assert.equal(error.evidence.error.credential_revoked, true)
      assert.ok(error.evidence.checks.includes('credential_revoked'))
      assert.ok(error.evidence.checks.includes('revoked_denied'))
      assert.equal(JSON.stringify(error.evidence).includes(fake.token), false)
      assertNoScopedSecret(error.evidence)
      return true
    },
  )
})

test('secret leak detector rejects raw scoped credentials', () => {
  assert.throws(() => assertNoScopedSecret(`bcsub_v1.11111111-1111-1111-1111-111111111111.${'y'.repeat(43)}`), /leaked/)
})
