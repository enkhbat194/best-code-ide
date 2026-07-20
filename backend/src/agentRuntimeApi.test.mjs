import assert from 'node:assert/strict'
import test from 'node:test'

import { handleAgentRuntime } from './agentRuntimeApi.ts'

const created = '2026-07-21T00:00:00.000Z'
const task = (task_id, overrides = {}) => ({
  task_id, title: task_id, priority: 'normal', status: 'pending', dependency_ids: [], created_at: created, ...overrides,
})

function envWithStore() {
  const records = new Map()
  const stub = {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/project-tasks') {
        const body = await request.json()
        if (records.has(body.task_id)) return Response.json({ error: 'Project task already exists' }, { status: 409 })
        records.set(body.task_id, body)
        return Response.json(body, { status: 201 })
      }
      if (request.method === 'GET' && url.pathname === '/project-tasks') {
        const items = [...records.values()].filter((item) => item.project_id === url.searchParams.get('project_id'))
        return Response.json({ items, count: items.length, total: items.length })
      }
      const match = url.pathname.match(/^\/project-tasks\/([^/]+)(?:\/update)?$/)
      if (match && request.method === 'GET') {
        const item = records.get(match[1])
        return item ? Response.json(item) : Response.json({ error: 'Project task not found' }, { status: 404 })
      }
      if (match && request.method === 'POST' && url.pathname.endsWith('/update')) {
        const current = records.get(match[1])
        if (!current) return Response.json({ error: 'Project task not found' }, { status: 404 })
        const update = await request.json()
        const item = { ...current, ...update, updated_at: new Date().toISOString() }
        records.set(match[1], item)
        return Response.json(item)
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    },
  }
  return { APPROVALS: { idFromName(name) { return name }, get() { return stub } } }
}

test('planning API returns queue counts', async () => {
  const url = new URL('https://bestcode.test/api/agent-runtime/plan')
  const response = await handleAgentRuntime(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks: [
      task('11111111-1111-4111-8111-111111111111', { status: 'completed' }),
      task('22222222-2222-4222-8222-222222222222', { priority: 'critical', dependency_ids: ['11111111-1111-4111-8111-111111111111'] }),
    ] }),
  }), envWithStore(), url)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).counts.ready, 1)
})

test('creates, reads, lists, and updates durable tasks', async () => {
  const env = envWithStore()
  const id = '33333333-3333-4333-8333-333333333333'
  const createUrl = new URL('https://bestcode.test/api/agent-runtime/tasks')
  const createdResponse = await handleAgentRuntime(new Request(createUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: id, title: 'Architecture', priority: 'high', dependency_ids: [] }),
  }), env, createUrl)
  assert.equal(createdResponse.status, 201)

  const readUrl = new URL(`https://bestcode.test/api/agent-runtime/tasks/${id}`)
  assert.equal((await (await handleAgentRuntime(new Request(readUrl), env, readUrl)).json()).title, 'Architecture')

  const updateUrl = new URL(`https://bestcode.test/api/agent-runtime/tasks/${id}/update`)
  const updated = await (await handleAgentRuntime(new Request(updateUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'running', agent_id: 'architect-agent' }),
  }), env, updateUrl)).json()
  assert.equal(updated.status, 'running')
  assert.equal(updated.agent_id, 'architect-agent')

  const listUrl = new URL('https://bestcode.test/api/agent-runtime/tasks?status=running')
  const listed = await (await handleAgentRuntime(new Request(listUrl), env, listUrl)).json()
  assert.equal(listed.count, 1)
})

test('capabilities reports durable storage enabled', async () => {
  const url = new URL('https://bestcode.test/api/agent-runtime/capabilities')
  const payload = await (await handleAgentRuntime(new Request(url), envWithStore(), url)).json()
  assert.equal(payload.durable_storage, true)
  assert.equal(payload.provider_dispatch, false)
})
