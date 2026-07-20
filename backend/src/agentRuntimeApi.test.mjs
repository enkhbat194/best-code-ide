import assert from 'node:assert/strict'
import test from 'node:test'

import { handleAgentRuntime } from './agentRuntimeApi.ts'

const created = '2026-07-21T00:00:00.000Z'

function task(task_id, overrides = {}) {
  return {
    task_id,
    title: task_id,
    priority: 'normal',
    status: 'pending',
    dependency_ids: [],
    created_at: created,
    ...overrides,
  }
}

test('planning API returns ready, waiting, blocked, running, and completed counts', async () => {
  const url = new URL('https://bestcode.test/api/agent-runtime/plan')
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: [
        task('architecture', { status: 'completed' }),
        task('implementation', { priority: 'critical', dependency_ids: ['architecture'] }),
        task('test', { dependency_ids: ['implementation'] }),
        task('review', { status: 'running' }),
        task('failed-build', { status: 'failed' }),
      ],
    }),
  })

  const response = await handleAgentRuntime(request, url)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.counts, {
    total: 5,
    ready: 1,
    waiting: 1,
    blocked: 1,
    running: 1,
    completed: 1,
  })
  assert.equal(payload.ready[0].task_id, 'implementation')
})

test('planning API rejects unsafe or invalid graphs', async () => {
  const url = new URL('https://bestcode.test/api/agent-runtime/plan')
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks: [task('a', { dependency_ids: ['missing'] })] }),
  })

  const response = await handleAgentRuntime(request, url)
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /missing task/)
})

test('capabilities endpoint states that storage and provider dispatch are not enabled yet', async () => {
  const url = new URL('https://bestcode.test/api/agent-runtime/capabilities')
  const response = await handleAgentRuntime(new Request(url), url)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.durable_storage, false)
  assert.equal(payload.provider_dispatch, false)
  assert.equal(payload.max_tasks_per_plan, 500)
})
