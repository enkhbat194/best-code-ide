import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalStore } from './approvalStore.ts'
import { applyCriticalPathRisk } from './criticalPaths.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, value)
  }

  async list(options = {}) {
    const prefix = options.prefix ?? ''
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)))
  }
}

function operation(path) {
  const now = new Date()
  return {
    operation_id: crypto.randomUUID(),
    project_id: 'bestcode',
    repository: {
      owner: 'enkhbat194',
      repo: 'best-code-ide',
      full_name: 'enkhbat194/best-code-ide',
    },
    branch: 'agent/phase-2-1d-live-canary-closeout',
    title: 'Phase 2.1D canary staging',
    summary: 'Verify ordinary and critical staged-operation policy without delivery.',
    status: 'pending_approval',
    approval_required: true,
    risk: 'normal',
    risk_reasons: [],
    changes: [{
      action: 'create',
      path,
      base_sha: null,
      base_content: null,
      proposed_content: 'canary only\n',
      diff: `+ canary ${path}`,
    }],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
  }
}

function harness() {
  const storage = new MemoryStorage()
  const store = new ApprovalStore({ storage })
  return { storage, store }
}

async function create(store, value) {
  return store.fetch(new Request('https://approval-store/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  }))
}

test('Package B ordinary canary remains normal and is cancelled without delivery', async () => {
  const { store } = harness()
  const staged = operation('docs/canary/ordinary-fixture.txt')
  applyCriticalPathRisk(staged)

  assert.equal(staged.risk, 'normal')
  assert.deepEqual(staged.risk_reasons, [])
  assert.equal((await create(store, staged)).status, 201)

  const cancelledResponse = await store.fetch(new Request(
    `https://approval-store/operations/${staged.operation_id}/cancel`,
    { method: 'POST' },
  ))
  assert.equal(cancelledResponse.status, 200)
  const cancelled = await cancelledResponse.json()
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.prepared_commit_sha, undefined)
  assert.equal(cancelled.pushed_at, undefined)
  assert.equal(cancelled.pr_number, undefined)
})

test('Package B critical canary becomes high risk with exact rule/path and is superseded without delivery', async () => {
  const { store } = harness()
  const staged = operation('docs/ROADMAP.md')
  applyCriticalPathRisk(staged)

  assert.equal(staged.risk, 'high')
  assert.deepEqual(staged.risk_reasons, [
    'critical_path:BC-R31',
    'critical_path_file:docs/ROADMAP.md',
  ])
  assert.equal((await create(store, staged)).status, 201)

  const reason = 'PACKAGE_B_CANARY_COMPLETE: policy evidence captured; operation must not be delivered'
  const supersededResponse = await store.fetch(new Request(
    `https://approval-store/operations/${staged.operation_id}/supersede`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  ))
  assert.equal(supersededResponse.status, 200)
  const superseded = await supersededResponse.json()
  assert.equal(superseded.status, 'superseded')
  assert.equal(superseded.superseded_reason, reason)
  assert.equal(superseded.prepared_commit_sha, undefined)
  assert.equal(superseded.pushed_at, undefined)
  assert.equal(superseded.pr_number, undefined)
})
