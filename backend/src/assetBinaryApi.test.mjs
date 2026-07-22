import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAssetBinaryApi } from './assetBinaryApi.ts'
import { normalizeAssetCreate, normalizeAssetUpdate } from './assetSchema.ts'
import { arrayBufferToHex, assetObjectKey, sha256Hex } from './assetStorage.ts'

function cloneMetadata(value) {
  return value ? structuredClone(value) : {}
}

class FakeR2Object {
  constructor(key, bytes, options = {}, checksums = {}) {
    this.key = key
    this.version = 'v1'
    this.size = bytes.byteLength
    this.etag = 'fake'
    this.httpEtag = '"fake"'
    this.uploaded = new Date('2026-07-22T11:00:00.000Z')
    this.httpMetadata = cloneMetadata(options.httpMetadata)
    this.customMetadata = cloneMetadata(options.customMetadata)
    this.range = undefined
    this.checksums = checksums
    this.storageClass = 'Standard'
  }

  writeHttpMetadata(headers) {
    if (this.httpMetadata.contentType) headers.set('Content-Type', this.httpMetadata.contentType)
  }
}

class FakeR2Body extends FakeR2Object {
  constructor(key, bytes, options, checksums) {
    super(key, bytes, options, checksums)
    this.bytes = bytes
    this.body = new ReadableStream({ start: (controller) => { controller.enqueue(bytes.slice()); controller.close() } })
    this.bodyUsed = false
  }

  async arrayBuffer() { return this.bytes.slice().buffer }
  async text() { return new TextDecoder().decode(this.bytes) }
  async json() { return JSON.parse(await this.text()) }
  async blob() { return new Blob([this.bytes]) }
}

class FakeR2Bucket {
  records = new Map()
  puts = 0

  async put(key, value, options = {}) {
    const bytes = Uint8Array.from(value)
    const expected = options.sha256 ? arrayBufferToHex(options.sha256) : null
    const actual = await sha256Hex(bytes)
    if (expected && actual !== expected) throw new Error(`checksum mismatch: expected ${expected}, received ${actual}`)
    const object = new FakeR2Object(key, bytes, options, { sha256: options.sha256 })
    this.records.set(key, { bytes, options, object })
    this.puts += 1
    return object
  }

  async get(key) {
    const record = this.records.get(key)
    return record ? new FakeR2Body(key, record.bytes, record.options, record.object.checksums) : null
  }

  async head(key) { return this.records.get(key)?.object ?? null }
  async delete(key) { this.records.delete(key) }
  async createMultipartUpload() { throw new Error('not used') }
  resumeMultipartUpload() { throw new Error('not used') }
}

class FakeBrainStub {
  constructor(asset) {
    this.asset = asset
    this.failStoredUpdateOnce = false
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === `/assets/${this.asset.asset_id}`) {
      return new Response(JSON.stringify(this.asset), { headers: { 'Content-Type': 'application/json' } })
    }
    if (request.method === 'POST' && url.pathname === `/assets/${this.asset.asset_id}/update`) {
      const body = await request.json()
      if (this.failStoredUpdateOnce && body.upload_status === 'stored') {
        this.failStoredUpdateOnce = false
        return new Response(JSON.stringify({ error: 'synthetic stored metadata failure' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      try {
        const updated = normalizeAssetUpdate(this.asset, body, new Date().toISOString())
        const idempotent = updated.version === this.asset.version
        this.asset = updated
        return new Response(JSON.stringify({ asset: updated, idempotent }), { headers: { 'Content-Type': 'application/json' } })
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return new Response(JSON.stringify({ error: 'Asset not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

function env(asset, bucket = new FakeR2Bucket()) {
  const brain = new FakeBrainStub(asset)
  return {
    bucket,
    brain,
    value: {
      ASSET_BUCKET: bucket,
      BRAIN_STORE: {
        idFromName: () => ({ toString: () => 'brain-id' }),
        get: () => brain,
      },
    },
  }
}

function assetFor(bytes, sha256) {
  return normalizeAssetCreate({
    asset_id: 'asset-binary-0001',
    project_id: 'bestcode',
    filename: 'tiny.png',
    media_type: 'image/png',
    size_bytes: bytes.byteLength,
    sha256,
    origin: 'owner_upload',
    sensitivity: 'private',
    created_by: 'owner',
    idempotency_key: 'asset-binary-0001',
  }, '2026-07-22T11:00:00.000Z')
}

function putRequest(assetId, bytes) {
  return new Request(`https://bestcode.test/api/brain/assets/${assetId}/content`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
    },
    body: bytes,
  })
}

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 66, 101, 115, 116, 67, 111, 100, 101])
const sha = await sha256Hex(bytes)

test('secure binary API stores, reuses, downloads privately, and deletes with Brain metadata parity', async () => {
  const state = env(assetFor(bytes, sha))
  const put = await handleAssetBinaryApi(putRequest(state.brain.asset.asset_id, bytes), state.value)
  assert.equal(put.status, 201)
  assert.equal(state.brain.asset.upload_status, 'stored')
  assert.equal(state.brain.asset.storage_provider, 'r2')
  assert.equal(state.brain.asset.storage_key, assetObjectKey({ projectId: 'bestcode', assetId: state.brain.asset.asset_id, sha256: sha }))
  assert.equal(state.bucket.puts, 1)

  const duplicate = await handleAssetBinaryApi(putRequest(state.brain.asset.asset_id, bytes), state.value)
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).idempotent, true)
  assert.equal(state.bucket.puts, 1)

  const head = await handleAssetBinaryApi(new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`, { method: 'HEAD' }), state.value)
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(head.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.match(head.headers.get('Content-Disposition'), /^attachment;/)
  assert.equal(head.headers.get('Content-Length'), String(bytes.byteLength))

  const get = await handleAssetBinaryApi(new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`), state.value)
  assert.equal(get.status, 200)
  assert.equal(await sha256Hex(new Uint8Array(await get.arrayBuffer())), sha)

  const remove = await handleAssetBinaryApi(new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`, { method: 'DELETE' }), state.value)
  assert.equal(remove.status, 200)
  assert.equal(state.brain.asset.upload_status, 'deleted')
  assert.equal(state.bucket.records.size, 0)

  const repeatedDelete = await handleAssetBinaryApi(new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`, { method: 'DELETE' }), state.value)
  assert.equal(repeatedDelete.status, 200)
  assert.equal((await repeatedDelete.json()).idempotent, true)

  const missing = await handleAssetBinaryApi(new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`), state.value)
  assert.equal(missing.status, 404)
})

test('secure binary API rejects a body checksum mismatch, removes R2 data, and marks metadata failed', async () => {
  const state = env(assetFor(bytes, 'a'.repeat(64)))
  const response = await handleAssetBinaryApi(putRequest(state.brain.asset.asset_id, bytes), state.value)
  assert.equal(response.status, 422)
  assert.match((await response.json()).error, /checksum mismatch|SHA-256 mismatch/i)
  assert.equal(state.brain.asset.upload_status, 'failed')
  assert.equal(state.bucket.records.size, 0)
})

test('secure binary API compensates an R2 write when the final Brain metadata update fails', async () => {
  const state = env(assetFor(bytes, sha))
  state.brain.failStoredUpdateOnce = true
  const response = await handleAssetBinaryApi(putRequest(state.brain.asset.asset_id, bytes), state.value)
  assert.equal(response.status, 502)
  assert.match((await response.json()).error, /synthetic stored metadata failure/)
  assert.equal(state.brain.asset.upload_status, 'failed')
  assert.equal(state.bucket.records.size, 0)
})

test('secure binary API fails closed without binding and rejects concurrent upload state', async () => {
  const missingBindingState = env(assetFor(bytes, sha))
  delete missingBindingState.value.ASSET_BUCKET
  const missingBinding = await handleAssetBinaryApi(putRequest(missingBindingState.brain.asset.asset_id, bytes), missingBindingState.value)
  assert.equal(missingBinding.status, 503)

  const concurrentState = env(assetFor(bytes, sha))
  concurrentState.brain.asset = normalizeAssetUpdate(concurrentState.brain.asset, {
    expected_version: concurrentState.brain.asset.version,
    upload_status: 'uploading',
  })
  const concurrent = await handleAssetBinaryApi(putRequest(concurrentState.brain.asset.asset_id, bytes), concurrentState.value)
  assert.equal(concurrent.status, 409)
  assert.equal(concurrentState.bucket.puts, 0)
})

test('secure binary API validates declared size and media type before mutating metadata', async () => {
  const state = env(assetFor(bytes, sha))
  const wrongSize = new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.byteLength + 1) },
    body: bytes,
  })
  assert.equal((await handleAssetBinaryApi(wrongSize, state.value)).status, 422)
  assert.equal(state.brain.asset.upload_status, 'pending')

  const wrongType = new Request(`https://bestcode.test/api/brain/assets/${state.brain.asset.asset_id}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength) },
    body: bytes,
  })
  assert.equal((await handleAssetBinaryApi(wrongType, state.value)).status, 415)
  assert.equal(state.brain.asset.upload_status, 'pending')
})
