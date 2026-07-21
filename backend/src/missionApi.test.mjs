import assert from 'node:assert/strict'
import test from 'node:test'

import { handleMissionApi } from './missionApi.ts'

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

const missionId = '11111111-1111-4111-8111-111111111111'

async function call(env, path, method = 'GET', body) {
  const url = new URL(`https://bestcode.test${path}`)
  return handleMissionApi(new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }), env, url)
}

test('creates, reads, lists, and transitions a durable Mission', async () => {
  const env = envWithStore()
  const created = await (await call(env, '/api/missions', 'POST', {
    mission_id: missionId,
    project_id: 'bestcode',
    title: 'Build Mission Control',
  })).json()
  assert.equal(created.lifecycle, 'captured')
  assert.equal(created.context_version, 1)
  assert.match(created.context_hash, /^fnv1a32:/)

  const transitioned = await (await call(env, `/api/missions/${missionId}/transition`, 'POST', {
    expected_context_version: 1,
    lifecycle: 'framing',
  })).json()
  assert.equal(transitioned.lifecycle, 'framing')
  assert.equal(transitioned.context_version, 2)

  const read = await (await call(env, `/api/missions/${missionId}`)).json()
  assert.equal(read.context_hash, transitioned.context_hash)

  const listed = await (await call(env, '/api/missions')).json()
  assert.equal(listed.count, 1)
})

test('stale context version and invalid lifecycle fail closed', async () => {
  const env = envWithStore()
  await call(env, '/api/missions', 'POST', { mission_id: missionId, project_id: 'bestcode', title: 'Mission' })

  const stale = await call(env, `/api/missions/${missionId}/transition`, 'POST', {
    expected_context_version: 9,
    lifecycle: 'framing',
  })
  assert.equal(stale.status, 409)

  const invalid = await call(env, `/api/missions/${missionId}/transition`, 'POST', {
    expected_context_version: 1,
    lifecycle: 'completed',
  })
  assert.equal(invalid.status, 409)
})

test('writer lease permits one holder and supports heartbeat/release', async () => {
  const env = envWithStore()
  await call(env, '/api/missions', 'POST', { mission_id: missionId, project_id: 'bestcode', title: 'Mission' })

  const acquired = await (await call(env, `/api/missions/${missionId}/lease`, 'POST', {
    expected_context_version: 1,
    command: 'acquire',
    holder_id: 'chatgpt',
    lease_id: '22222222-2222-4222-8222-222222222222',
    ttl_seconds: 60,
  })).json()
  assert.equal(acquired.writer_lease.holder_id, 'chatgpt')

  const blocked = await call(env, `/api/missions/${missionId}/lease`, 'POST', {
    expected_context_version: 2,
    command: 'acquire',
    holder_id: 'claude',
    lease_id: '33333333-3333-4333-8333-333333333333',
  })
  assert.equal(blocked.status, 409)

  const released = await (await call(env, `/api/missions/${missionId}/lease`, 'POST', {
    expected_context_version: 2,
    command: 'release',
    holder_id: 'chatgpt',
  })).json()
  assert.equal(released.writer_lease, null)
})