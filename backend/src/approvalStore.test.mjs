import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalStore } from './approvalStore.ts'
import { executeDeliveryMcpTool } from './mcpDeliveryTools.ts'
import { executeDeploymentMcpTool } from './mcpDeploymentTools.ts'
import { executeSafeWriteMcpTool } from './mcpWriteTools.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
    this.puts = new Map()
  }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, value)
    this.puts.set(key, (this.puts.get(key) ?? 0) + 1)
  }

  async list(options = {}) {
    const prefix = options.prefix ?? ''
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)))
  }
}

function operation(overrides = {}) {
  const now = new Date()
  return {
    operation_id: crypto.randomUUID(),
    project_id: 'bestcode',
    repository: { owner: 'enkhbat194', repo: 'best-code-ide', full_name: 'enkhbat194/best-code-ide' },
    branch: 'agent/approval-terminal-state-v1',
    title: 'Approval contract test',
    summary: 'Exercise a single owner-bound approval decision.',
    status: 'pending_approval',
    approval_required: true,
    risk: 'normal',
    risk_reasons: [],
    changes: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  }
}

function harness() {
  const storage = new MemoryStorage()
  const store = new ApprovalStore({ storage })
  return { storage, store }
}

function envFor(store) {
  const stub = {
    fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      return store.fetch(request)
    },
  }
  return {
    AUTH_TOKEN: 'test-auth-token',
    GITHUB_TOKEN: 'test-github-token',
    APPROVALS: {
      idFromName(name) {
        return name
      },
      get() {
        return stub
      },
    },
  }
}

async function create(store, value) {
  return store.fetch(new Request('https://approval-store/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  }))
}

async function decide(store, operationId, decision, idempotencyKey) {
  return store.fetch(new Request(`https://approval-store/operations/${operationId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, actor: 'pwa-owner', idempotency_key: idempotencyKey }),
  }))
}

test('an exact decision replay is idempotent and cannot create a second transition', async () => {
  const { storage, store } = harness()
  const value = operation()
  assert.equal((await create(store, value)).status, 201)

  const key = crypto.randomUUID()
  const firstResponse = await decide(store, value.operation_id, 'approved', key)
  assert.equal(firstResponse.status, 200)
  const first = await firstResponse.json()
  assert.equal(first.status, 'approved')
  assert.equal(first.decision_actor, 'pwa-owner')
  assert.equal(first.decision_idempotency_key, key)
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 2)

  const replayResponse = await decide(store, value.operation_id, 'approved', key)
  assert.equal(replayResponse.status, 200)
  const replay = await replayResponse.json()
  assert.equal(replay.decided_at, first.decided_at)
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 2)

  const newRequest = await decide(store, value.operation_id, 'approved', crypto.randomUUID())
  assert.equal(newRequest.status, 409)
  const opposite = await decide(store, value.operation_id, 'rejected', key)
  assert.equal(opposite.status, 409)
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 2)

  const completedResponse = await store.fetch(new Request(
    `https://approval-store/operations/${value.operation_id}/completed`,
    { method: 'POST' },
  ))
  assert.equal(completedResponse.status, 200)
  const progressedReplay = await decide(store, value.operation_id, 'approved', key)
  assert.equal(progressedReplay.status, 200)
  assert.equal((await progressedReplay.json()).status, 'completed')
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 3)
})

test('expired approval is terminal and cannot be decided', async () => {
  const { storage, store } = harness()
  const value = operation({ expires_at: new Date(Date.now() - 1_000).toISOString() })
  await storage.put(`operation:${value.operation_id}`, value)

  const response = await decide(store, value.operation_id, 'approved', crypto.randomUUID())
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.operation.status, 'expired')
  assert.ok(body.operation.expired_at)
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 2)
})

test('stale context supersedes a pending or approved operation exactly once', async () => {
  const { storage, store } = harness()
  const value = operation()
  assert.equal((await create(store, value)).status, 201)
  assert.equal((await decide(store, value.operation_id, 'approved', crypto.randomUUID())).status, 200)

  const reason = 'BASE_CONFLICT: approved base SHA no longer matches'
  const supersede = () => store.fetch(new Request(
    `https://approval-store/operations/${value.operation_id}/supersede`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  ))

  const first = await supersede()
  assert.equal(first.status, 200)
  const stale = await first.json()
  assert.equal(stale.status, 'superseded')
  assert.equal(stale.superseded_reason, reason)
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 3)

  assert.equal((await supersede()).status, 200)
  assert.equal(storage.puts.get(`operation:${value.operation_id}`), 3)
  assert.equal((await decide(store, value.operation_id, 'approved', crypto.randomUUID())).status, 409)
})

test('new operations cannot be injected in an already-approved state', async () => {
  const { store } = harness()
  const response = await create(store, operation({ status: 'approved' }))
  assert.equal(response.status, 409)
})

test('changed file-delivery context is invalidated before a commit object is created', async (t) => {
  const { store } = harness()
  const env = envFor(store)
  const originalFetch = globalThis.fetch
  let writeCalls = 0
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.github.com')
    if (request.method !== 'GET') writeCalls += 1
    if (request.method === 'GET' && url.pathname.endsWith('/contents/src/example.ts')) {
      return new Response(JSON.stringify({
        type: 'file',
        sha: 'file-sha-old',
        content: btoa('export const value = 1\n'),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/approval-context')) {
      return new Response(JSON.stringify({
        name: 'agent/approval-context',
        protected: false,
        commit: { sha: 'branch-sha-old' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (request.method === 'GET' && url.pathname.endsWith('/git/ref/heads/agent/approval-context')) {
      return new Response(JSON.stringify({ object: { sha: 'branch-sha-new' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const staged = await executeSafeWriteMcpTool(
    'repository_write_file',
    {
      project_id: 'bestcode',
      branch: 'agent/approval-context',
      path: 'src/example.ts',
      content: 'export const value = 2\n',
    },
    'test-github-token',
    env,
  )
  assert.equal(staged.structuredContent.status, 'pending_approval')
  const operationId = staged.structuredContent.operation_id
  assert.equal((await decide(store, operationId, 'approved', crypto.randomUUID())).status, 200)

  const delivered = await executeDeliveryMcpTool(
    'repository_commit',
    { project_id: 'bestcode', operation_id: operationId },
    'test-github-token',
    env,
  )
  assert.equal(delivered.structuredContent.ok, false)
  assert.equal(delivered.structuredContent.error.code, 'CONFLICT')
  assert.equal(writeCalls, 0)

  const stored = await (await store.fetch(
    new Request(`https://approval-store/operations/${operationId}`),
  )).json()
  assert.equal(stored.status, 'superseded')
  assert.match(stored.superseded_reason, /CONTEXT_CONFLICT/)
})

test('changed production source SHA invalidates deployment approval without dispatch', async (t) => {
  const { store } = harness()
  const env = envFor(store)
  const originalFetch = globalThis.fetch
  let branchReads = 0
  let dispatchCalls = 0
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.github.com')
    if (request.method === 'GET' && url.pathname.endsWith('/branches/main')) {
      branchReads += 1
      const sha = branchReads === 1 ? 'approved-main-sha' : 'changed-main-sha'
      return new Response(JSON.stringify({ name: 'main', protected: true, commit: { sha } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (request.method === 'POST' && url.pathname.includes('/actions/workflows/')) {
      dispatchCalls += 1
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const requested = await executeDeploymentMcpTool(
    'deployment_start',
    { project_id: 'bestcode', branch: 'main', target: 'all' },
    'test-github-token',
    env,
  )
  assert.equal(requested.structuredContent.status, 'pending_approval')
  assert.equal(requested.structuredContent.result.source_sha, 'approved-main-sha')
  const operationId = requested.structuredContent.operation_id
  assert.equal((await decide(store, operationId, 'approved', crypto.randomUUID())).status, 200)

  const started = await executeDeploymentMcpTool(
    'deployment_start',
    {
      project_id: 'bestcode',
      branch: 'main',
      target: 'all',
      approval_operation_id: operationId,
    },
    'test-github-token',
    env,
  )
  assert.equal(started.structuredContent.ok, false)
  assert.equal(started.structuredContent.error.code, 'DEPLOYMENT_CONTEXT_STALE')
  assert.equal(dispatchCalls, 0)

  const stored = await (await store.fetch(
    new Request(`https://approval-store/operations/${operationId}`),
  )).json()
  assert.equal(stored.status, 'superseded')
  assert.match(stored.superseded_reason, /approved-main-sha.*changed-main-sha/)
})
