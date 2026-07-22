import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assetCreateFingerprint,
  assetFromBrainObject,
  assetToBrainObject,
  buildAssetDuplicateKey,
  buildAssetStorageKey,
  normalizeAssetCreate,
  normalizeAssetUpdate,
} from './assetSchema.ts'
import { BrainStore } from './brainStore.ts'

const brainApiSource = await readFile(new URL('./brainApi.ts', import.meta.url), 'utf8')
const assetStoreSource = await readFile(new URL('./assetStore.ts', import.meta.url), 'utf8')
const brainStoreSource = await readFile(new URL('./brainStore.ts', import.meta.url), 'utf8')
const filesSource = await readFile(new URL('./files.ts', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
const securitySource = await readFile(new URL('./security.ts', import.meta.url), 'utf8')
const typesSource = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
const wranglerSource = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8')

const now = '2026-07-22T05:00:00.000Z'
const sha = 'a'.repeat(64)

function assetInput(overrides = {}) {
  return {
    asset_id: 'asset-image-0001',
    project_id: 'bestcode',
    mission_id: 'mission-assets-0001',
    source_id: 'source-chat-0001',
    filename: 'diagram.png',
    media_type: 'image/png',
    size_bytes: 1234,
    sha256: sha,
    created_by: 'owner',
    ...overrides,
  }
}

class MemoryStorage {
  values = new Map()

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value))
  }

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
  return new BrainStore({ storage: new MemoryStorage() })
}

async function request(store, path, method = 'GET', body) {
  const response = await store.fetch(new Request(`https://brain-store${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  return { response, json: await response.json() }
}

test('asset schema validates, sanitizes, and preserves typed metadata', () => {
  const asset = normalizeAssetCreate(assetInput({ filename: '<script>diagram.png', api_key: 'sk-secret-value' }), now)
  assert.equal(asset.filename, '_script_diagram.png')
  assert.equal(asset.asset_kind, 'image')
  assert.equal(asset.upload_status, 'pending')
  assert.equal(asset.processing_status, 'not_requested')
  assert.ok(!JSON.stringify(asset).includes('sk-secret-value'))
  assert.equal(buildAssetDuplicateKey('bestcode', sha, 1234), `asset-duplicate:bestcode:${sha}:1234`)

  assert.throws(() => normalizeAssetCreate(assetInput({ filename: '../secret.png' }), now), /path or control sequence/)
  assert.throws(() => normalizeAssetCreate(assetInput({ media_type: 'not a mime' }), now), /media_type is invalid/)
  assert.throws(() => normalizeAssetCreate(assetInput({ media_type: 'application/x-msdownload' }), now), /not allowed/)
  assert.throws(() => normalizeAssetCreate(assetInput({ size_bytes: -1 }), now), /non-negative/)
  assert.throws(() => normalizeAssetCreate(assetInput({ size_bytes: Number.NaN }), now), /non-negative/)
  assert.throws(() => normalizeAssetCreate(assetInput({ sha256: 'bad' }), now), /64-character/)
})

test('asset status, storage key, version, and immutable identity contracts are enforced', () => {
  const pending = normalizeAssetCreate(assetInput(), now)
  const uploading = normalizeAssetUpdate(pending, { expected_version: 1, upload_status: 'uploading' }, '2026-07-22T05:01:00.000Z')
  const storageKey = buildAssetStorageKey(pending.project_id, pending.asset_id, pending.sha256)
  const stored = normalizeAssetUpdate(uploading, {
    expected_version: 2,
    upload_status: 'stored',
    storage_provider: 'r2',
    storage_key: storageKey,
  }, '2026-07-22T05:02:00.000Z')
  const queued = normalizeAssetUpdate(stored, { expected_version: 3, processing_status: 'queued' }, '2026-07-22T05:03:00.000Z')

  assert.equal(queued.version, 4)
  assert.equal(queued.storage_key, storageKey)
  assert.throws(() => normalizeAssetUpdate(queued, { expected_version: 4, sha256: 'b'.repeat(64) }, now), /immutable/)
  assert.throws(() => normalizeAssetUpdate(queued, { expected_version: 3, display_name: 'stale.png' }, now), /version mismatch/)
  assert.throws(() => normalizeAssetUpdate(stored, { expected_version: 3, upload_status: 'pending' }, now), /Invalid upload status transition/)
  const idempotent = normalizeAssetUpdate(stored, { expected_version: 3, upload_status: 'stored' }, now)
  assert.equal(idempotent.version, 3)

  const roundTrip = assetFromBrainObject(assetToBrainObject(queued))
  assert.deepEqual(roundTrip, queued)
  assert.equal(assetCreateFingerprint(roundTrip), assetCreateFingerprint(queued))
})

test('AI-generated artifacts require generated provenance', () => {
  const generated = normalizeAssetCreate(assetInput({
    asset_id: 'asset-report-0001',
    filename: 'report.md',
    media_type: 'text/markdown',
    asset_kind: 'generated_artifact',
    origin: 'ai_generated',
    sha256: 'b'.repeat(64),
    size_bytes: 0,
    created_by: 'claude',
  }), now)
  assert.equal(generated.asset_kind, 'generated_artifact')
  assert.equal(generated.origin, 'ai_generated')
  assert.throws(() => normalizeAssetCreate(assetInput({ asset_kind: 'generated_artifact' }), now), /generated provenance/)
})

test('Brain Store asset metadata API supports create, read, list, update, duplicate reuse, and relations', async () => {
  const store = createStore()
  const source = await request(store, '/objects', 'POST', {
    object_id: 'source-chat-0001',
    project_id: 'bestcode',
    mission_id: 'mission-assets-0001',
    kind: 'source',
    title: 'Owner upload request',
    body: 'Store this image.',
    created_by: 'owner',
  })
  assert.equal(source.response.status, 201)

  const created = await request(store, '/assets', 'POST', assetInput())
  assert.equal(created.response.status, 201)
  assert.equal(created.json.created, true)
  assert.equal(created.json.asset.version, 1)

  const repeated = await request(store, '/assets', 'POST', assetInput())
  assert.equal(repeated.response.status, 200)
  assert.equal(repeated.json.idempotent, true)
  assert.equal(repeated.json.asset.asset_id, 'asset-image-0001')

  const duplicate = await request(store, '/assets', 'POST', assetInput({
    asset_id: 'asset-image-0002',
    idempotency_key: 'upload-second-reference',
  }))
  assert.equal(duplicate.response.status, 200)
  assert.equal(duplicate.json.duplicate, true)
  assert.equal(duplicate.json.reused_asset_id, 'asset-image-0001')

  const list = await request(store, '/assets?project_id=bestcode&mission_id=mission-assets-0001')
  assert.equal(list.response.status, 200)
  assert.equal(list.json.total, 1)
  assert.equal(list.json.items[0].source_id, 'source-chat-0001')

  const relation = await request(store, '/relations', 'POST', {
    relation_id: 'relation-source-asset-0001',
    project_id: 'bestcode',
    mission_id: 'mission-assets-0001',
    from_object_id: 'source-chat-0001',
    to_object_id: 'asset-image-0001',
    relation_type: 'has_asset',
    created_by: '4b-ingestion',
  })
  assert.equal(relation.response.status, 201)

  const uploading = await request(store, '/assets/asset-image-0001/update', 'POST', {
    expected_version: 1,
    upload_status: 'uploading',
  })
  assert.equal(uploading.response.status, 200)
  assert.equal(uploading.json.asset.version, 2)

  const storageKey = buildAssetStorageKey('bestcode', 'asset-image-0001', sha)
  const stored = await request(store, '/assets/asset-image-0001/update', 'POST', {
    expected_version: 2,
    upload_status: 'stored',
    storage_provider: 'r2',
    storage_key: storageKey,
  })
  assert.equal(stored.response.status, 200)
  assert.equal(stored.json.asset.upload_status, 'stored')

  const stale = await request(store, '/assets/asset-image-0001/update', 'POST', {
    expected_version: 1,
    display_name: 'stale.png',
  })
  assert.equal(stale.response.status, 400)
  assert.match(stale.json.error, /version mismatch/)

  const genericAsset = await request(store, '/objects', 'POST', {
    object_id: 'asset-bypass-0001',
    project_id: 'bestcode',
    kind: 'asset',
    title: 'Bypass',
    created_by: 'owner',
  })
  assert.equal(genericAsset.response.status, 409)

  const exported = await request(store, '/export?project_id=bestcode')
  assert.equal(exported.response.status, 200)
  assert.ok(exported.json.objects.some((item) => item.object_id === 'asset-image-0001' && item.kind === 'asset'))
  assert.ok(exported.json.relations.some((item) => item.relation_id === 'relation-source-asset-0001'))
})

test('duplicate and idempotency indexes remain project-isolated', async () => {
  const store = createStore()
  const first = await request(store, '/assets', 'POST', assetInput())
  assert.equal(first.response.status, 201)

  const conflict = await request(store, '/assets', 'POST', assetInput({
    asset_id: 'asset-other-0001',
    filename: 'other.png',
    idempotency_key: 'asset-image-0001',
  }))
  assert.equal(conflict.response.status, 409)
  assert.match(conflict.json.error, /Idempotency key/)

  const otherProject = await request(store, '/assets', 'POST', assetInput({
    asset_id: 'asset-other-project-0001',
    project_id: 'other-project',
    mission_id: 'mission-other-0001',
    source_id: 'source-other-0001',
    idempotency_key: 'other-project-upload',
    sensitivity: 'private',
  }))
  assert.equal(otherProject.response.status, 201)
  assert.equal(otherProject.json.asset.project_id, 'other-project')
})

test('asset foundation preserves security and locks the approved private R2 production binding', () => {
  assert.match(typesSource, /MAX_ASSET_BYTES\?: string/)
  assert.match(brainApiSource, /X-BestCode-Asset-Max-Bytes/)
  assert.match(assetStoreSource, /buildAssetDuplicateKey/)
  assert.match(brainStoreSource, /Use \/assets for typed asset metadata/)
  assert.match(indexSource, /handleBrainApi\(req, env, url\)/)
  assert.match(indexSource, /persistSecurityAudit/)
  assert.match(filesSource, /Direct changes to main\/master are blocked/)
  assert.match(securitySource, /redactSensitive/)
  assert.match(wranglerSource, /\[\[r2_buckets\]\][\s\S]*binding = "ASSET_BUCKET"[\s\S]*bucket_name = "best-code-ide-assets-prod"/)
  assert.doesNotMatch(wranglerSource, /name = "ASSETS"/)
  assert.match(wranglerSource, /No r2\.dev public URL/)
  assert.match(wranglerSource, /name = "BRAIN_STORE"/)
})
