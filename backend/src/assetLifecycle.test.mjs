import assert from 'node:assert/strict'
import test from 'node:test'
import { BrainStore } from './brainStore.ts'

const shaA = 'a'.repeat(64)
const shaB = 'b'.repeat(64)

class MemoryStorage {
  values = new Map()

  async get(key) { return this.values.get(key) }
  async put(key, value) { this.values.set(key, structuredClone(value)) }
  async delete(key) {
    const keys = Array.isArray(key) ? key : [key]
    let deleted = false
    for (const item of keys) deleted = this.values.delete(item) || deleted
    return deleted
  }
  async list(options = {}) {
    const prefix = options.prefix ?? ''
    const entries = [...this.values.entries()].filter(([key]) => key.startsWith(prefix))
    if (options.reverse) entries.reverse()
    return new Map(entries.map(([key, value]) => [key, structuredClone(value)]))
  }
}

function createStore() {
  const storage = new MemoryStorage()
  return { storage, store: new BrainStore({ storage }) }
}

async function request(store, path, method = 'GET', body) {
  const response = await store.fetch(new Request(`https://brain-store${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  return { response, json: await response.json() }
}

async function createObject(store, object_id, kind, project_id = 'bestcode') {
  const result = await request(store, '/objects', 'POST', {
    object_id,
    project_id,
    kind,
    title: `${kind}:${object_id}`,
    created_by: 'owner',
  })
  assert.equal(result.response.status, 201)
  return result.json
}

function assetInput(overrides = {}) {
  return {
    asset_id: 'asset-source-0001',
    project_id: 'bestcode',
    mission_id: 'mission-0001',
    source_id: 'source-0001',
    filename: 'source.txt',
    media_type: 'text/plain',
    size_bytes: 10,
    sha256: shaA,
    created_by: 'owner',
    ...overrides,
  }
}

test('asset relationship lifecycle supports multi-mission/source links, semantic idempotency, and cross-project isolation', async () => {
  const { store } = createStore()
  await createObject(store, 'bestcode', 'project')
  await createObject(store, 'mission-0001', 'mission')
  await createObject(store, 'mission-0002', 'mission')
  await createObject(store, 'source-0001', 'source')
  await createObject(store, 'source-0002', 'source')
  await createObject(store, 'other-project', 'project', 'other-project')
  await createObject(store, 'other-mission', 'mission', 'other-project')

  const created = await request(store, '/assets', 'POST', assetInput())
  assert.equal(created.response.status, 201)
  assert.equal(created.json.links.relations.length, 3)

  const initialRefs = await request(store, '/assets/asset-source-0001/references')
  assert.equal(initialRefs.response.status, 200)
  assert.equal(initialRefs.json.active_reference_count, 2)
  assert.equal(initialRefs.json.total_relationship_count, 3)

  const missionLink = await request(store, '/assets/asset-source-0001/links', 'POST', {
    relation_type: 'used_by_mission',
    target_object_id: 'mission-0002',
    created_by: 'owner',
    provenance: { actor_type: 'owner', actor_id: 'owner', tool: 'bestcode-chat' },
  })
  assert.equal(missionLink.response.status, 201)
  assert.equal(missionLink.json.created, true)

  const repeatedMissionLink = await request(store, '/assets/asset-source-0001/links', 'POST', {
    relation_id: 'different-client-relation-id',
    relation_type: 'used_by_mission',
    target_object_id: 'mission-0002',
    created_by: 'owner',
  })
  assert.equal(repeatedMissionLink.response.status, 200)
  assert.equal(repeatedMissionLink.json.idempotent, true)
  assert.equal(repeatedMissionLink.json.relation.relation_id, missionLink.json.relation.relation_id)

  const sourceLink = await request(store, '/assets/asset-source-0001/links', 'POST', {
    relation_type: 'attached_to_source',
    target_object_id: 'source-0002',
    created_by: 'owner',
  })
  assert.equal(sourceLink.response.status, 201)

  const refs = await request(store, '/assets/asset-source-0001/references')
  assert.equal(refs.json.active_reference_count, 4)
  assert.equal(refs.json.by_type.used_by_mission, 2)
  assert.equal(refs.json.by_type.attached_to_source, 2)

  const crossProject = await request(store, '/assets/asset-source-0001/links', 'POST', {
    relation_type: 'used_by_mission',
    target_object_id: 'other-mission',
    created_by: 'owner',
  })
  assert.equal(crossProject.response.status, 400)
  assert.match(crossProject.json.error, /Cross-project/)

  const detached = await request(
    store,
    `/assets/asset-source-0001/links/${sourceLink.json.relation.relation_id}?actor_id=owner`,
    'DELETE',
  )
  assert.equal(detached.response.status, 200)
  assert.equal(detached.json.deleted, true)
  const afterDetach = await request(store, '/assets/asset-source-0001/references')
  assert.equal(afterDetach.json.active_reference_count, 3)
})

test('AI-generated artifacts keep protected origin, Agent run provenance, and derived_from source assets', async () => {
  const { store } = createStore()
  await createObject(store, 'bestcode', 'project')
  await createObject(store, 'agent-run-0001', 'agent_run')

  const sourceAsset = await request(store, '/assets', 'POST', assetInput({ mission_id: null, source_id: null }))
  assert.equal(sourceAsset.response.status, 201)

  const generated = await request(store, '/assets', 'POST', assetInput({
    asset_id: 'asset-generated-0001',
    mission_id: null,
    source_id: null,
    filename: 'report.md',
    media_type: 'text/markdown',
    asset_kind: 'generated_artifact',
    origin: 'ai_generated',
    size_bytes: 20,
    sha256: shaB,
    created_by: 'bestcode-agent',
    agent_run_id: 'agent-run-0001',
    derived_from_asset_ids: ['asset-source-0001'],
    provenance: {
      actor_type: 'agent',
      actor_id: 'bestcode-agent',
      tool: 'bestcode-runtime',
      model: 'provider-neutral-model-id',
      run_id: 'agent-run-0001',
    },
  }))
  assert.equal(generated.response.status, 201)
  assert.ok(generated.json.links.relations.some((relation) => relation.relation_type === 'generated_by'))
  assert.ok(generated.json.links.relations.some((relation) => relation.relation_type === 'derived_from'))
  assert.ok(generated.json.links.relations.every((relation) => relation.attributes.provenance.contract === 'provider-neutral-provenance-v1'))

  const invalidOrigin = await request(store, '/assets/asset-source-0001/links', 'POST', {
    relation_type: 'generated_by',
    target_object_id: 'agent-run-0001',
    created_by: 'owner',
  })
  assert.equal(invalidOrigin.response.status, 400)
  assert.match(invalidOrigin.json.error, /protected generated origin/)
})

test('duplicate reuse creates relationships without creating a second asset or binary identity', async () => {
  const { store } = createStore()
  await createObject(store, 'bestcode', 'project')
  await createObject(store, 'mission-0001', 'mission')
  await createObject(store, 'mission-0002', 'mission')
  await createObject(store, 'source-0001', 'source')
  await createObject(store, 'source-0002', 'source')

  const first = await request(store, '/assets', 'POST', assetInput())
  assert.equal(first.response.status, 201)

  const duplicate = await request(store, '/assets', 'POST', assetInput({
    asset_id: 'asset-duplicate-request-0002',
    mission_id: 'mission-0002',
    source_id: 'source-0002',
    idempotency_key: 'duplicate-reference-0002',
  }))
  assert.equal(duplicate.response.status, 200)
  assert.equal(duplicate.json.duplicate, true)
  assert.equal(duplicate.json.reused_asset_id, 'asset-source-0001')
  assert.equal(duplicate.json.binary_created, false)

  const assets = await request(store, '/assets?project_id=bestcode')
  assert.equal(assets.json.total, 1)
  const refs = await request(store, '/assets/asset-source-0001/references')
  assert.equal(refs.json.active_reference_count, 4)

  const events = await request(store, '/events?project_id=bestcode&event_type=asset_reused')
  assert.equal(events.json.total, 1)
  assert.equal(events.json.items[0].details.binary_created, false)
})

test('cleanup removes dangling/deleted relationships and Brain export includes an asset manifest', async () => {
  const { store, storage } = createStore()
  await createObject(store, 'bestcode', 'project')
  await createObject(store, 'source-0001', 'source')
  const created = await request(store, '/assets', 'POST', assetInput({ mission_id: null }))
  assert.equal(created.response.status, 201)

  const refs = await request(store, '/assets/asset-source-0001/references')
  const sourceRelation = refs.json.relationships.find((relation) => relation.relation_type === 'attached_to_source')
  assert.ok(sourceRelation)

  await storage.delete(['brain-object:bestcode:source:source-0001', 'brain-object-id:source-0001'])
  const cleanup = await request(store, '/assets/asset-source-0001/cleanup', 'POST')
  assert.equal(cleanup.response.status, 200)
  assert.ok(cleanup.json.removed_relation_ids.includes(sourceRelation.relation_id))

  const exported = await request(store, '/export?project_id=bestcode')
  assert.equal(exported.response.status, 200)
  assert.equal(exported.json.asset_manifest.schema, 'asset-manifest-v1')
  assert.equal(exported.json.asset_manifest.count, 1)
  assert.equal(exported.json.asset_manifest.items[0].asset_id, 'asset-source-0001')
  assert.ok(exported.json.asset_manifest.relationships.every((relation) => relation.relation_type !== 'attached_to_source'))
})
