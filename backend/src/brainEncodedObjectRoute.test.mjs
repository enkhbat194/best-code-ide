import assert from 'node:assert/strict'
import test from 'node:test'

import { BrainStore } from './brainStore.ts'

class FakeStorage {
  constructor(entries = []) {
    this.values = new Map(entries)
  }

  async get(key) { return this.values.get(key) }
  async put(key, value) { this.values.set(key, value) }
  async delete(key) {
    for (const item of Array.isArray(key) ? key : [key]) this.values.delete(item)
  }
  async list() { return new Map() }
}

function objectFixture(objectId) {
  return {
    object_id: objectId,
    project_id: 'bestcode',
    mission_id: null,
    kind: 'agent_run',
    title: 'Encoded route fixture',
    body: null,
    attributes: {},
    source_ids: [],
    truth_status: 'interpreted',
    sensitivity: 'private',
    retention: 'project',
    expires_at: null,
    created_by: 'test',
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    version: 1,
  }
}

test('BrainStore decodes URL-encoded processing object identifiers before lookup and update', async () => {
  const objectId = 'apj:0123456789abcdef'
  const object = objectFixture(objectId)
  const storageKey = `brain-object:${object.project_id}:${object.kind}:${object.object_id}`
  const storage = new FakeStorage([
    [`brain-object-id:${objectId}`, storageKey],
    [storageKey, object],
  ])
  const store = new BrainStore({ storage })
  const encoded = encodeURIComponent(objectId)

  const read = await store.fetch(new Request(`https://brain-store/objects/${encoded}`))
  assert.equal(read.status, 200)
  assert.equal((await read.json()).object_id, objectId)

  const update = await store.fetch(new Request(`https://brain-store/objects/${encoded}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: 1, title: 'Updated encoded fixture' }),
  }))
  assert.equal(update.status, 200)
  assert.equal((await update.json()).title, 'Updated encoded fixture')
})

test('BrainStore rejects malformed encoded object identifiers without storage access', async () => {
  const store = new BrainStore({ storage: new FakeStorage() })
  const response = await store.fetch(new Request('https://brain-store/objects/apj%ZZbad'))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'Invalid Brain object id')
})
