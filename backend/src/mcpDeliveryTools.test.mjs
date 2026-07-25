import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalStore } from './approvalStore.ts'
import { executeDeliveryMcpTool } from './mcpDeliveryTools.ts'

class MemoryStorage {
  constructor() { this.values = new Map() }
  async get(key) { return this.values.get(key) }
  async put(key, value) { this.values.set(key, structuredClone(value)) }
  async list(options = {}) {
    return new Map([...this.values]
      .filter(([key]) => key.startsWith(options.prefix ?? ''))
      .map(([key, value]) => [key, structuredClone(value)]))
  }
}

function harness() {
  const storage = new MemoryStorage()
  const store = new ApprovalStore({ storage })
  return {
    storage,
    env: {
      PROJECTS_JSON: JSON.stringify([{
        id: 'bestcode',
        name: 'BestCode',
        owner: 'enkhbat194',
        repo: 'best-code-ide',
        defaultBranch: 'main',
        buildWorkflow: 'validate.yml',
        testWorkflow: 'test.yml',
      }]),
      APPROVALS: {
        idFromName: (name) => name,
        get: () => ({ fetch: (input, init) => store.fetch(new Request(input, init)) }),
      },
    },
  }
}

test('workflow task keeps the pushed approval operation binding for authoritative result evidence', async (t) => {
  const { env, storage } = harness()
  const operationId = '11111111-1111-1111-1111-111111111111'
  await storage.put(`operation:${operationId}`, {
    operation_id: operationId,
    project_id: 'bestcode',
    repository: { owner: 'enkhbat194', repo: 'best-code-ide', full_name: 'enkhbat194/best-code-ide' },
    branch: 'agent/chat11-smoke-abc123',
    title: 'Smoke',
    summary: 'Smoke',
    status: 'pushed',
    approval_required: true,
    risk: 'normal',
    risk_reasons: [],
    changes: [],
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z',
    pushed_at: '2026-07-25T00:00:00.000Z',
    expires_at: '2026-07-26T00:00:00.000Z',
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    assert.equal(request.method, 'POST')
    assert.match(request.url, /\/actions\/workflows\/validate\.yml\/dispatches$/)
    return new Response(null, { status: 204 })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const result = await executeDeliveryMcpTool('build_start', {
    project_id: 'bestcode',
    branch: 'agent/chat11-smoke-abc123',
    operation_id: operationId,
  }, 'test-github-token', env)

  assert.equal(result.structuredContent.ok, true)
  const task = await storage.get(`task:${result.structuredContent.task_id}`)
  assert.equal(task.operation_id, operationId)
  assert.equal(task.kind, 'build')
  assert.equal(task.branch, 'agent/chat11-smoke-abc123')
})
