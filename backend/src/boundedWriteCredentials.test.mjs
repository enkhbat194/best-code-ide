import assert from 'node:assert/strict'
import test from 'node:test'

import {
  boundedWriteCredentialCreate,
  boundedWriteCredentialGet,
  boundedWriteCredentialRevoke,
  boundedWriteScopeHash,
  authorizeBoundedWriteOperation,
} from './boundedWriteCredentials.ts'
import { authenticateRequest } from './authentication.ts'
import { handleMcp } from './mcp.ts'
import { executeSafeWriteMcpTool } from './mcpWriteTools.ts'
import {
  BOUNDED_WRITE_PROFILE,
  DEFAULT_BOUNDED_WRITE_TTL_SECONDS,
} from './boundedWriteCredentialTypes.ts'
import { SecurityAuditStore } from './securityAuditStore.ts'
import { subscriptionToolNames } from './subscriptionTools.ts'

class MemoryStorage {
  constructor() { this.values = new Map() }
  async get(key) { return this.values.get(key) }
  async put(key, value) { this.values.set(key, structuredClone(value)) }
  async delete(keys) {
    let count = 0
    for (const key of Array.isArray(keys) ? keys : [keys]) if (this.values.delete(key)) count += 1
    return count
  }
  async list(options = {}) {
    let entries = [...this.values.entries()].filter(([key]) => key.startsWith(options.prefix ?? ''))
    entries.sort(([left], [right]) => left.localeCompare(right))
    if (options.reverse) entries.reverse()
    return new Map(entries.map(([key, value]) => [key, structuredClone(value)]))
  }
}

function environment() {
  const storage = new MemoryStorage()
  const durable = new SecurityAuditStore({ storage })
  return {
    storage,
    env: {
      GITHUB_TOKEN: 'test-github-token',
      AUTH_TOKEN: 'test-owner-token',
      PROJECTS_JSON: JSON.stringify([
        { id: 'bestcode', name: 'BestCode', owner: 'enkhbat194', repo: 'best-code-ide', defaultBranch: 'main' },
      ]),
      SECURITY_AUDIT: {
        idFromName: (name) => name,
        get: () => ({ fetch: (url, init) => durable.fetch(new Request(url, init)) }),
      },
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
      'X-BestCode-Agent-Id': 'spoofed-agent',
      'X-BestCode-Agent-Provider': 'spoofed-provider',
    },
    body: JSON.stringify(body),
  })
}

const baseInput = {
  project_id: 'bestcode',
  mission_id: '11111111-1111-1111-1111-111111111111',
  execution_plan_id: '22222222-2222-2222-2222-222222222222',
  task_id: '33333333-3333-3333-3333-333333333333',
  attempt_id: '44444444-4444-4444-4444-444444444444',
  lease_id: '55555555-5555-5555-5555-555555555555',
  fencing_token: 7,
  agent_id: 'chatgpt-codex',
  provider: 'openai',
  branch: 'agent/chat11-smoke-abc123',
  base_sha: '554908b69fa855e2292a88357c67fc340e457370',
  allowed_tools: [...subscriptionToolNames, 'repository_create_branch', 'repository_write_file'],
  allowed_paths: ['docs/smoke/**'],
  limits: {
    max_operations: 20,
    max_changed_files: 1,
    max_total_changed_bytes: 4096,
    max_commits: 1,
    max_pushes: 1,
    max_pull_requests: 1,
  },
  idempotency_namespace: 'chat11-smoke-attempt-4444',
  approval_record_id: 'approval-chat11-smoke',
}

test('bounded write credential is fully bound, short-lived, and raw-secret-free at rest', async () => {
  const { env, storage } = environment()
  const issuedAt = '2026-07-24T06:00:00.000Z'
  const issued = await boundedWriteCredentialCreate(env, baseInput, issuedAt)

  assert.match(issued.secret, /^bcwrite_v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]+$/)
  assert.equal(issued.credential.profile, BOUNDED_WRITE_PROFILE)
  assert.equal(issued.credential.expires_at, new Date(Date.parse(issuedAt) + DEFAULT_BOUNDED_WRITE_TTL_SECONDS * 1000).toISOString())
  assert.equal(issued.credential.status, 'active')
  assert.equal(issued.credential.branch, baseInput.branch)
  assert.equal(issued.credential.fencing_token, 7)
  assert.equal(issued.credential.usage.operations, 0)
  assert.equal('secret_hash' in issued.credential, false)
  assert.ok(issued.credential.denied_paths.includes('.github/workflows/**'))

  const persisted = JSON.stringify([...storage.values.values()])
  assert.equal(persisted.includes(issued.secret), false)
  assert.equal(persisted.includes(issued.secret.split('.').at(-1)), false)
  assert.match(persisted, /"secret_hash":"[a-f0-9]{64}"/)

  const fetched = await boundedWriteCredentialGet(env, issued.credential.credential_id)
  assert.equal('secret_hash' in fetched, false)
  assert.deepEqual(fetched, issued.credential)
})

test('scope hash is deterministic and changes for any authoritative binding change', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput, '2026-07-24T06:00:00.000Z')
  const storedScope = {
    ...issued.credential,
  }
  delete storedScope.status
  delete storedScope.issued_at
  delete storedScope.expires_at
  delete storedScope.usage
  delete storedScope.scope_hash
  const expected = await boundedWriteScopeHash(storedScope)
  assert.equal(issued.credential.scope_hash, expected)
  assert.notEqual(expected, await boundedWriteScopeHash({ ...storedScope, task_id: 'different-task' }))
  assert.notEqual(expected, await boundedWriteScopeHash({ ...storedScope, branch: 'agent/other' }))
})

test('TTL above two hours and unsafe/invalid bindings fail closed', async () => {
  const { env } = environment()
  await assert.rejects(
    boundedWriteCredentialCreate(env, { ...baseInput, expires_in_seconds: 7_201 }),
    /between 300 and 7200/,
  )
  await assert.rejects(
    boundedWriteCredentialCreate(env, { ...baseInput, branch: 'main branch' }),
    /branch is invalid/,
  )
  await assert.rejects(
    boundedWriteCredentialCreate(env, { ...baseInput, limits: { ...baseInput.limits, max_pull_requests: 2 } }),
    /max_pull_requests is invalid/,
  )
})

test('owner-side revoke is idempotent and immediately changes public status', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput)
  const first = await boundedWriteCredentialRevoke(env, issued.credential.credential_id)
  const second = await boundedWriteCredentialRevoke(env, issued.credential.credential_id)
  assert.equal(first.status, 'revoked')
  assert.equal(second.revoked_at, first.revoked_at)
})

test('read-only profile remains exact and independent from bounded write profile', () => {
  assert.equal(subscriptionToolNames.length, 12)
  assert.equal(new Set(subscriptionToolNames).size, 12)
  assert.equal(subscriptionToolNames.some((name) => /write|patch|commit|push|create_branch/.test(name)), false)
})

test('authentication selects the stored bounded profile and authoritative identity', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput, '2026-07-24T06:00:00.000Z')
  const request = mcpRequest(issued.secret, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  const authentication = await authenticateRequest(request, env, '2026-07-24T06:01:00.000Z')
  assert.equal(authentication.attempted_kind, 'bounded-write')
  assert.equal(authentication.principal?.kind, 'bounded-write')
  assert.equal(authentication.principal?.agent_id, baseInput.agent_id)
  assert.equal(authentication.principal?.provider, baseInput.provider)
  assert.equal(authentication.principal?.branch, baseInput.branch)

  const crossProject = await authenticateRequest(
    mcpRequest(issued.secret, { jsonrpc: '2.0', id: 2, method: 'initialize' }, '/mcp/subscription?project_id=other'),
    env,
    '2026-07-24T06:01:00.000Z',
  )
  assert.equal(crossProject.principal, null)
  assert.equal(crossProject.denial_code, 'INVALID_BOUNDED_WRITE_CREDENTIAL')
})

test('bounded MCP advertises only credential-allowed tools and excludes owner capabilities', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput, '2026-07-24T06:00:00.000Z')
  const request = mcpRequest(issued.secret, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  const authentication = await authenticateRequest(request, env, '2026-07-24T06:01:00.000Z')
  const response = await handleMcp(request, env, authentication.principal)
  const body = await response.json()
  const names = body.result.tools.map((tool) => tool.name)
  assert.deepEqual(names.sort(), baseInput.allowed_tools.slice().sort())
  for (const forbidden of [
    'repository_delete_branch', 'repository_delete_file', 'deployment_start',
    'rollback_request', 'approval_decide', 'subscription_credential_create',
  ]) assert.equal(names.includes(forbidden), false)
  for (const tool of body.result.tools) assert.ok(tool.description.length <= 300)
})

test('bounded MCP rejects tool, branch, project, and path widening before execution', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput, '2026-07-24T06:00:00.000Z')
  const principal = (await authenticateRequest(
    mcpRequest(issued.secret, { jsonrpc: '2.0', id: 1, method: 'initialize' }),
    env,
    '2026-07-24T06:01:00.000Z',
  )).principal

  const cases = [
    {
      name: 'deployment_start',
      args: { project_id: 'bestcode' },
      code: 'TOOL_SCOPE_DENIED',
    },
    {
      name: 'repository_write_file',
      args: { project_id: 'other', branch: baseInput.branch, path: 'docs/smoke/a.md', content: 'safe' },
      code: 'PROJECT_SCOPE_DENIED',
    },
    {
      name: 'repository_write_file',
      args: { project_id: 'bestcode', branch: 'agent/other', path: 'docs/smoke/a.md', content: 'safe' },
      code: 'BRANCH_SCOPE_DENIED',
    },
    {
      name: 'repository_write_file',
      args: { project_id: 'bestcode', branch: baseInput.branch, path: '.github/workflows/evil.yml', content: 'safe' },
      code: 'PROTECTED_PATH_DENIED',
    },
    {
      name: 'repository_write_file',
      args: { project_id: 'bestcode', branch: baseInput.branch, path: 'backend/src/index.ts', content: 'safe' },
      code: 'PATH_SCOPE_DENIED',
    },
  ]
  for (const [index, item] of cases.entries()) {
    const response = await handleMcp(
      mcpRequest(issued.secret, {
        jsonrpc: '2.0',
        id: index + 10,
        method: 'tools/call',
        params: { name: item.name, arguments: item.args },
      }),
      env,
      principal,
    )
    const body = await response.json()
    assert.equal(body.error.data.code, item.code)
  }
})

test('operation accounting is atomic, idempotent, and fails closed at every limit', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, {
    ...baseInput,
    limits: {
      max_operations: 2,
      max_changed_files: 1,
      max_total_changed_bytes: 10,
      max_commits: 1,
      max_pushes: 1,
      max_pull_requests: 1,
    },
  })
  const principal = {
    kind: 'bounded-write',
    ...issued.credential,
  }
  delete principal.status
  delete principal.issued_at

  const first = await authorizeBoundedWriteOperation(env, principal, {
    tool: 'repository_write_file',
    idempotency_key: 'write-1',
    changed_files: 1,
    changed_bytes: 10,
  })
  assert.equal(first.replayed, false)
  assert.equal(first.usage.operations, 1)
  assert.equal(first.usage.changed_files, 1)

  const replay = await authorizeBoundedWriteOperation(env, principal, {
    tool: 'repository_write_file',
    idempotency_key: 'write-1',
    changed_files: 1,
    changed_bytes: 10,
  })
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.usage, first.usage)

  await assert.rejects(
    authorizeBoundedWriteOperation(env, principal, {
      tool: 'repository_write_file',
      idempotency_key: 'write-2',
      changed_files: 1,
    }),
    /OPERATION_LIMIT_EXCEEDED/,
  )
  await assert.rejects(
    authorizeBoundedWriteOperation(env, principal, {
      tool: 'deployment_start',
      idempotency_key: 'deploy-1',
    }),
    /TOOL_SCOPE_DENIED/,
  )
})

test('branch creation checks the approved base SHA before creating a ref', async (t) => {
  const { env } = environment()
  const originalFetch = globalThis.fetch
  let createCalls = 0
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname.endsWith('/branches/main')) {
      return new Response(JSON.stringify({
        name: 'main',
        protected: true,
        commit: { sha: 'different-main-sha' },
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (request.method === 'POST') createCalls += 1
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const result = await executeSafeWriteMcpTool('repository_create_branch', {
    project_id: 'bestcode',
    name: baseInput.branch,
    from_branch: 'main',
    expected_base_sha: baseInput.base_sha,
  }, 'test-github-token', env)
  assert.equal(result.structuredContent.ok, false)
  assert.match(result.structuredContent.error.message, /CONTEXT_CONFLICT/)
  assert.equal(createCalls, 0)
})
