import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_TOOLS, assertNoScopedSecret, runScopedSubscriptionAuthSmoke } from './scoped-subscription-auth-smoke.mjs'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('controller keeps the scoped secret out of immutable evidence and revokes it', async () => {
  const token = `bcsub_v1.11111111-1111-1111-1111-111111111111.${'x'.repeat(43)}`
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, project: url.searchParams.get('project_id'), authorization: init.headers?.Authorization })
    if (url.pathname === '/api/subscription/credentials' && init.method === 'POST') {
      return response({ credential: { credential_id: '11111111-1111-1111-1111-111111111111' }, secret: token }, 201)
    }
    if (url.pathname.endsWith('/revoke')) return response({ credential: { status: 'revoked' } })
    if (url.pathname === '/mcp' || url.searchParams.get('project_id') === 'bestcode-wrong') return response({ error: 'Unauthorized' }, 401)
    const request = JSON.parse(init.body)
    if (request.method === 'initialize') {
      const revoked = calls.some((call) => call.path.endsWith('/revoke'))
      return revoked ? response({ error: 'Unauthorized' }, 401) : response({ jsonrpc: '2.0', id: request.id, result: { serverInfo: { name: 'bestcode-subscription-agent-gateway' } } })
    }
    if (request.method === 'tools/list') {
      return response({ jsonrpc: '2.0', id: request.id, result: { tools: REQUIRED_TOOLS.map((name) => ({ name })) } })
    }
    if (request.params.name === 'project_get') {
      return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: {
        ok: true, actor: { id: 'github-actions-scoped-smoke' }, audit: { credential_id: '11111111-1111-1111-1111-111111111111' },
      } } })
    }
    return response({ jsonrpc: '2.0', id: request.id, result: { structuredContent: { error: { code: 'TOOL_DISABLED_FOR_PROFILE' } } } })
  }

  const evidence = await runScopedSubscriptionAuthSmoke({
    backendUrl: 'https://bestcode.example', ownerToken: 'owner-secret', fetchImpl,
  })
  assert.equal(evidence.status, 'passed')
  assert.equal(JSON.stringify(evidence).includes(token), false)
  assert.ok(evidence.checks.includes('credential_revoked'))
  assert.ok(evidence.checks.includes('revoked_denied'))
  assertNoScopedSecret(evidence)
})

test('secret leak detector rejects raw scoped credentials', () => {
  assert.throws(() => assertNoScopedSecret(`bcsub_v1.11111111-1111-1111-1111-111111111111.${'y'.repeat(43)}`), /leaked/)
})
