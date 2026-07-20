import assert from 'node:assert/strict'
import test from 'node:test'

import { handleMaintenance } from './maintenance.ts'

const mainSha = 'a'.repeat(40)
const validAgentSha = 'b'.repeat(40)
const changedAgentOldSha = 'c'.repeat(40)
const changedAgentNewSha = 'd'.repeat(40)

function operation(overrides = {}) {
  return {
    operation_id: crypto.randomUUID(),
    project_id: 'bestcode',
    repository: { owner: 'enkhbat194', repo: 'best-code-ide', full_name: 'enkhbat194/best-code-ide' },
    branch: 'agent/valid-context',
    title: 'Maintenance regression operation',
    summary: 'Branch-aware stale approval test.',
    status: 'pending_approval',
    approval_required: true,
    risk: 'normal',
    risk_reasons: [],
    changes: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    base_context_sha: validAgentSha,
    ...overrides,
  }
}

function envFor(operations, superseded) {
  const stub = {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname === '/operations') {
        return Response.json({ items: operations, count: operations.length, total: operations.length })
      }
      const match = url.pathname.match(/^\/operations\/([^/]+)\/supersede$/)
      if (request.method === 'POST' && match) {
        const body = await request.json()
        superseded.push({ operationId: match[1], reason: body.reason })
        const current = operations.find((item) => item.operation_id === match[1])
        return Response.json({ ...current, status: 'superseded', superseded_reason: body.reason })
      }
      return new Response('not found', { status: 404 })
    },
  }
  return {
    GITHUB_TOKEN: 'test-github-token',
    APPROVALS: {
      idFromName(name) { return name },
      get() { return stub },
    },
  }
}

function installGithub(t) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.github.com')

    if (request.method === 'GET' && url.pathname.endsWith('/branches/main')) {
      return Response.json({ name: 'main', protected: true, commit: { sha: mainSha } })
    }
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/valid-context')) {
      return Response.json({ name: 'agent/valid-context', protected: false, commit: { sha: validAgentSha } })
    }
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/changed-context')) {
      return Response.json({ name: 'agent/changed-context', protected: false, commit: { sha: changedAgentNewSha } })
    }
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/missing-context')) {
      return new Response('not found', { status: 404 })
    }
    if (request.method === 'GET' && /\/branches\?/.test(url.pathname + url.search)) {
      return Response.json([
        { name: 'main', protected: true, commit: { sha: mainSha } },
        { name: 'agent/valid-context', protected: false, commit: { sha: validAgentSha } },
      ])
    }
    if (request.method === 'GET' && url.pathname.includes('/compare/')) {
      return Response.json({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, commits: [], files: [] })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  }
  t.after(() => { globalThis.fetch = originalFetch })
}

test('maintenance plan checks each approval against its own branch instead of main', async (t) => {
  installGithub(t)
  const operations = [
    operation(),
    operation({ branch: 'main', base_context_sha: mainSha }),
    operation({ branch: 'agent/changed-context', base_context_sha: changedAgentOldSha }),
    operation({ branch: 'agent/missing-context', base_context_sha: 'e'.repeat(40) }),
  ]
  const superseded = []
  const env = envFor(operations, superseded)
  const url = new URL('https://bestcode.test/api/maintenance?project_id=bestcode')
  const response = await handleMaintenance(new Request(url), env, url)

  assert.equal(response.status, 200)
  const plan = await response.json()
  assert.equal(plan.counts.stale_approvals, 2)
  assert.deepEqual(
    plan.stale_approvals.map((item) => item.branch).sort(),
    ['agent/changed-context', 'agent/missing-context'],
  )
  assert.equal(plan.stale_approvals.some((item) => item.branch === 'agent/valid-context'), false)
  assert.equal(plan.stale_approvals.some((item) => item.branch === 'main'), false)
})

test('supersede endpoint mutates only branch-proven stale approvals', async (t) => {
  installGithub(t)
  const valid = operation()
  const changed = operation({ branch: 'agent/changed-context', base_context_sha: changedAgentOldSha })
  const operations = [valid, changed]
  const superseded = []
  const env = envFor(operations, superseded)
  const url = new URL('https://bestcode.test/api/maintenance/approvals/supersede?project_id=bestcode')
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmation: 'SUPERSEDE_STALE_APPROVALS',
      expected_main_sha: mainSha,
    }),
  })
  const response = await handleMaintenance(request, env, url)

  assert.equal(response.status, 200)
  assert.equal((await response.json()).updated, 1)
  assert.deepEqual(superseded.map((item) => item.operationId), [changed.operation_id])
  assert.match(superseded[0].reason, /agent\/changed-context changed/)
})
