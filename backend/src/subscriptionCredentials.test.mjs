import assert from 'node:assert/strict'
import test from 'node:test'

import { authenticateRequest, isAuthorized } from './authentication.ts'
import { handleMcp } from './mcp.ts'
import { SecurityAuditStore } from './securityAuditStore.ts'
import { handleSubscriptionCredentialApi } from './subscriptionCredentialApi.ts'
import {
  authenticateScopedCredential,
  subscriptionCredentialCreate,
  subscriptionCredentialGet,
  subscriptionCredentialList,
  subscriptionCredentialRevoke,
} from './subscriptionCredentials.ts'
import { subscriptionToolNames } from './subscriptionTools.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value))
  }

  async delete(keys) {
    const values = Array.isArray(keys) ? keys : [keys]
    let removed = 0
    for (const key of values) {
      if (this.values.delete(key)) removed += 1
    }
    return removed
  }

  async list(options = {}) {
    const prefix = options.prefix ?? ''
    let entries = [...this.values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))
    if (options.reverse) entries = entries.reverse()
    return new Map(entries.map(([key, value]) => [key, structuredClone(value)]))
  }
}

function testEnvironment() {
  const storage = new MemoryStorage()
  const durable = new SecurityAuditStore({ storage })
  const namespace = {
    idFromName(name) {
      return name
    },
    get() {
      return {
        fetch(url, init) {
          return durable.fetch(new Request(url, init))
        },
      }
    },
  }
  return {
    storage,
    env: {
      GITHUB_TOKEN: 'test-github-token',
      AUTH_TOKEN: 'test-owner-token',
      PROJECTS_JSON: JSON.stringify([
        { id: 'bestcode', name: 'BestCode', owner: 'enkhbat194', repo: 'best-code-ide', defaultBranch: 'main' },
        { id: 'czech-app', name: 'Czech app', owner: 'enkhbat194', repo: 'czech-mongolian-app', defaultBranch: 'main' },
      ]),
      SECURITY_AUDIT: namespace,
    },
  }
}

function mcpRequest(secret, body, path = '/mcp/subscription?project_id=bestcode') {
  return new Request(`https://bestcode.example${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      'X-BestCode-Request-Id': 'scoped-test-request',
      'X-BestCode-Agent-Id': 'spoofed-agent',
      'X-BestCode-Agent-Provider': 'spoofed-provider',
    },
    body: JSON.stringify(body),
  })
}

const issuedAt = '2026-07-24T00:00:00.000Z'

test('create stores only a one-way hash and list/get never return the secret', async () => {
  const { env, storage } = testEnvironment()
  const issued = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode',
    agent_id: 'chatgpt-codex',
    provider: 'openai',
    expires_in_seconds: 900,
    note: 'Chat 8 test',
  }, issuedAt)

  assert.match(issued.secret, /^bcsub_v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]+$/)
  assert.equal(issued.credential.status, 'active')
  assert.deepEqual(issued.credential.allowed_tools, subscriptionToolNames)
  assert.equal('secret_hash' in issued.credential, false)

  const persisted = JSON.stringify([...storage.values.values()])
  assert.equal(persisted.includes(issued.secret), false)
  assert.equal(persisted.includes(issued.secret.split('.').at(-1)), false)
  assert.match(persisted, /"secret_hash":"[a-f0-9]{64}"/)

  const listed = await subscriptionCredentialList(env, 'bestcode')
  const fetched = await subscriptionCredentialGet(env, issued.credential.credential_id)
  assert.equal(JSON.stringify(listed).includes(issued.secret), false)
  assert.equal(JSON.stringify(fetched).includes(issued.secret), false)
  assert.equal('secret_hash' in listed[0], false)
  assert.equal('secret_hash' in fetched, false)
})

test('valid scoped authentication is endpoint/project/profile locked and identity is authoritative', async () => {
  const { env } = testEnvironment()
  const issued = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode',
    agent_id: 'claude-remote-mcp',
    provider: 'anthropic',
    expires_in_seconds: 900,
  }, issuedAt)

  const auth = await authenticateRequest(
    mcpRequest(issued.secret, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    env,
    '2026-07-24T00:01:00.000Z',
  )
  assert.equal(auth.principal?.kind, 'subscription')
  assert.equal(auth.principal?.agent_id, 'claude-remote-mcp')
  assert.equal(auth.principal?.provider, 'anthropic')
  assert.equal(auth.principal?.project_id, 'bestcode')

  const response = await handleMcp(mcpRequest(issued.secret, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'repository_create_branch',
      arguments: { project_id: 'bestcode', name: 'agent/forbidden' },
    },
  }), env, auth.principal)
  const body = await response.json()
  assert.equal(body.result.structuredContent.actor.id, 'claude-remote-mcp')
  assert.equal(body.result.structuredContent.actor.provider, 'anthropic')
  assert.equal(body.result.structuredContent.error.code, 'TOOL_DISABLED_FOR_PROFILE')
  assert.equal(body.result.structuredContent.audit.credential_id, issued.credential.credential_id)
  assert.equal(body.result.structuredContent.audit.project_id, 'bestcode')
  assert.equal(body.result.structuredContent.audit.agent_id, 'claude-remote-mcp')
  assert.equal(body.result.structuredContent.audit.provider, 'anthropic')
  assert.equal(body.result.structuredContent.audit.denial_code, 'TOOL_DISABLED_FOR_PROFILE')
})

test('wrong, malformed, cross-project, and cross-endpoint scoped credentials fail generically', async () => {
  const { env } = testEnvironment()
  const issued = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode',
    agent_id: 'codex',
    provider: 'openai',
    expires_in_seconds: 900,
  }, issuedAt)

  const attempts = [
    mcpRequest(`${issued.secret}wrong`, { jsonrpc: '2.0', id: 1, method: 'initialize' }),
    mcpRequest('bcsub_v1.malformed', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
    mcpRequest(issued.secret, { jsonrpc: '2.0', id: 1, method: 'initialize' }, '/mcp/subscription?project_id=czech-app'),
    mcpRequest(issued.secret, { jsonrpc: '2.0', id: 1, method: 'initialize' }, '/mcp?project_id=bestcode'),
  ]
  for (const request of attempts) {
    const result = await authenticateRequest(request, env, '2026-07-24T00:01:00.000Z')
    assert.equal(result.principal, null)
    assert.equal(result.denial_code, 'INVALID_SCOPED_CREDENTIAL')
  }
})

test('expiry boundary, revoke, and disabled states deny immediately', async () => {
  const { env, storage } = testEnvironment()
  const issued = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode',
    agent_id: 'codex',
    provider: 'openai',
    expires_in_seconds: 300,
  }, issuedAt)

  assert.ok(await authenticateScopedCredential(env, issued.secret, {
    endpoint: '/mcp/subscription',
    project_id: 'bestcode',
    now: '2026-07-24T00:04:59.999Z',
  }))
  assert.equal(await authenticateScopedCredential(env, issued.secret, {
    endpoint: '/mcp/subscription',
    project_id: 'bestcode',
    now: '2026-07-24T00:05:00.000Z',
  }), null)

  const second = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode', agent_id: 'codex-2', provider: 'openai', expires_in_seconds: 900,
  }, issuedAt)
  await subscriptionCredentialRevoke(env, second.credential.credential_id, '2026-07-24T00:02:00.000Z')
  assert.equal(await authenticateScopedCredential(env, second.secret, {
    endpoint: '/mcp/subscription', project_id: 'bestcode', now: '2026-07-24T00:02:00.001Z',
  }), null)

  const third = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode', agent_id: 'codex-3', provider: 'openai', expires_in_seconds: 900,
  }, issuedAt)
  const key = `subscription-credential:${third.credential.credential_id}`
  const record = await storage.get(key)
  await storage.put(key, { ...record, disabled_at: '2026-07-24T00:01:00.000Z' })
  assert.equal(await authenticateScopedCredential(env, third.secret, {
    endpoint: '/mcp/subscription', project_id: 'bestcode', now: '2026-07-24T00:01:00.001Z',
  }), null)
})

test('owner authentication remains compatible and never treats scoped tokens as owner credentials', async () => {
  const { env } = testEnvironment()
  assert.equal(await isAuthorized(new Request('https://bestcode.example/mcp', {
    headers: { Authorization: 'Bearer test-owner-token' },
  }), env), true)
  assert.equal(await isAuthorized(new Request('https://bestcode.example/mcp?key=test-owner-token'), env), true)

  const issued = await subscriptionCredentialCreate(env, {
    project_id: 'bestcode', agent_id: 'codex', provider: 'openai', expires_in_seconds: 900,
  }, issuedAt)
  assert.equal(await isAuthorized(new Request('https://bestcode.example/mcp', {
    headers: { Authorization: `Bearer ${issued.secret}` },
  }), env), false)
})

test('owner API returns the raw credential once, then list/get omit it, and revoke is immediate', async () => {
  const { env } = testEnvironment()
  const owner = { kind: 'owner', identity: 'owner' }
  const createRequest = new Request('https://bestcode.example/api/subscription/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-BestCode-Request-Id': 'api-create-1' },
    body: JSON.stringify({ project_id: 'bestcode', agent_name: 'chatgpt', provider: 'openai', expires_in_seconds: 900 }),
  })
  const createdResponse = await handleSubscriptionCredentialApi(createRequest, env, new URL(createRequest.url), owner)
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json()
  assert.match(created.secret, /^bcsub_v1\./)
  assert.equal(created.secret_display, 'one-time')

  const listRequest = new Request('https://bestcode.example/api/subscription/credentials?project_id=bestcode')
  const listResponse = await handleSubscriptionCredentialApi(listRequest, env, new URL(listRequest.url), owner)
  const listed = await listResponse.json()
  assert.equal(JSON.stringify(listed).includes(created.secret), false)
  assert.equal('secret_hash' in listed.items[0], false)

  const getRequest = new Request(`https://bestcode.example/api/subscription/credentials/${created.credential.credential_id}`)
  const getResponse = await handleSubscriptionCredentialApi(getRequest, env, new URL(getRequest.url), owner)
  const fetched = await getResponse.json()
  assert.equal(JSON.stringify(fetched).includes(created.secret), false)

  const revokeRequest = new Request(`https://bestcode.example/api/subscription/credentials/${created.credential.credential_id}/revoke`, { method: 'POST' })
  const revokeResponse = await handleSubscriptionCredentialApi(revokeRequest, env, new URL(revokeRequest.url), owner)
  assert.equal(revokeResponse.status, 200)
  assert.equal(await authenticateScopedCredential(env, created.secret, {
    endpoint: '/mcp/subscription', project_id: 'bestcode',
  }), null)
})
