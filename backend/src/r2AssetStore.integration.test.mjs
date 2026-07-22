import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { arrayBufferToHex, sha256Hex } from './assetStorage.ts'
import { R2AssetStore, requireR2AssetStore } from './r2AssetStore.ts'

const typesSource = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
const wranglerSource = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
const binaryApiSource = await readFile(new URL('./assetBinaryApi.ts', import.meta.url), 'utf8')
const brainApiSource = await readFile(new URL('./brainApi.ts', import.meta.url), 'utf8')
const brainStoreSource = await readFile(new URL('./brainStore.ts', import.meta.url), 'utf8')
const securitySource = await readFile(new URL('./security.ts', import.meta.url), 'utf8')

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
    this.uploaded = new Date('2026-07-22T10:00:00.000Z')
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

class FakeMultipart {
  constructor(bucket, key, uploadId, options) {
    this.bucket = bucket
    this.key = key
    this.uploadId = uploadId
    this.options = options
    this.parts = new Map()
    this.aborted = false
  }

  async uploadPart(partNumber, value) {
    if (this.aborted) throw new Error('aborted')
    const bytes = Uint8Array.from(value)
    this.parts.set(partNumber, bytes)
    return { partNumber, etag: `etag-${partNumber}` }
  }

  async complete(parts) {
    const arrays = parts.map((part) => this.parts.get(part.partNumber))
    const size = arrays.reduce((sum, item) => sum + item.byteLength, 0)
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const item of arrays) { bytes.set(item, offset); offset += item.byteLength }
    const object = new FakeR2Object(this.key, bytes, this.options, {})
    this.bucket.records.set(this.key, { bytes, options: this.options, object })
    return object
  }

  async abort() { this.aborted = true }
}

class FakeR2Bucket {
  records = new Map()
  uploads = new Map()
  lastPut = null

  async put(key, value, options = {}) {
    const bytes = Uint8Array.from(value)
    const expected = options.sha256 ? arrayBufferToHex(options.sha256) : null
    const actual = await sha256Hex(bytes)
    if (expected && actual !== expected) throw new Error('checksum mismatch')
    const object = new FakeR2Object(key, bytes, options, { sha256: options.sha256 })
    this.records.set(key, { bytes, options, object })
    this.lastPut = { key, options }
    return object
  }

  async get(key) {
    const record = this.records.get(key)
    return record ? new FakeR2Body(key, record.bytes, record.options, record.object.checksums) : null
  }

  async head(key) { return this.records.get(key)?.object ?? null }
  async delete(key) { this.records.delete(key) }

  async createMultipartUpload(key, options = {}) {
    const upload = new FakeMultipart(this, key, crypto.randomUUID(), options)
    this.uploads.set(upload.uploadId, upload)
    return upload
  }

  resumeMultipartUpload(key, uploadId) {
    const upload = this.uploads.get(uploadId)
    if (!upload || upload.key !== key) throw new Error('missing upload')
    return upload
  }
}

const body = new TextEncoder().encode('r2 body')
const sha = await sha256Hex(body)
const ref = { projectId: 'bestcode', assetId: 'asset-r2-0001', sha256: sha }
const options = { body, sha256: sha, sizeBytes: body.byteLength, mediaType: 'application/pdf', filename: 'owner report.pdf' }

test('R2 adapter integration: checksum, private metadata, get/head/delete, and no public URL', async () => {
  const bucket = new FakeR2Bucket()
  const store = new R2AssetStore(bucket)
  const stored = await store.put(ref, options)
  assert.equal(stored.provider, 'r2')
  assert.equal(stored.access, 'private')
  assert.equal(stored.verification, 'provider-sha256-and-size')
  assert.equal(bucket.lastPut.options.httpMetadata.cacheControl, 'private, no-store')
  assert.equal(bucket.lastPut.options.customMetadata.access, 'private')
  assert.equal(arrayBufferToHex(bucket.lastPut.options.sha256), sha)
  assert.equal('url' in stored, false)
  const got = await store.get(ref)
  assert.equal(new TextDecoder().decode(await new Response(got.body).arrayBuffer()), 'r2 body')
  assert.equal(got.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal((await store.head(ref)).filename, 'owner report.pdf')
  await store.delete(ref)
  assert.equal(await store.head(ref), null)
})

test('R2 adapter security: missing binding fails closed', () => {
  assert.throws(() => requireR2AssetStore({}), /not configured; refusing binary storage/)
  assert.ok(requireR2AssetStore({ ASSET_BUCKET: new FakeR2Bucket() }) instanceof R2AssetStore)
})

test('R2 production binding and existing security/Brain routing remain regression-safe', () => {
  assert.match(typesSource, /ASSET_BUCKET\?: R2Bucket/)
  assert.match(wranglerSource, /\[\[r2_buckets\]\][\s\S]*binding = "ASSET_BUCKET"[\s\S]*bucket_name = "best-code-ide-assets-prod"/)
  assert.match(wranglerSource, /No r2\.dev public URL/)
  assert.match(indexSource, /handleAssetBinaryApi\(req, env, url\)/)
  assert.ok(indexSource.indexOf('handleAssetBinaryApi(req, env, url)') < indexSource.indexOf('handleBrainApi(req, env, url)'))
  assert.match(indexSource, /enforceRequestLimits/)
  assert.match(indexSource, /persistSecurityAudit/)
  assert.match(binaryApiSource, /Content-Length is required/)
  assert.match(binaryApiSource, /private, no-store|buildPrivateAssetHeaders/)
  assert.match(binaryApiSource, /await store\.delete\(ref\)/)
  assert.match(brainApiSource, /Brain v2 storage is not configured/)
  assert.match(brainStoreSource, /handleAssetStore/)
  assert.match(securitySource, /DEFAULT_ASSET_REQUEST_BYTES/)
  assert.match(securitySource, /redactSensitive/)
})
