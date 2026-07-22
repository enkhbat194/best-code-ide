import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASSET_MULTIPART_MIN_PART_BYTES,
  assetObjectKey,
  buildAssetContentDisposition,
  buildPrivateAssetHeaders,
  sha256Hex,
} from './assetStorage.ts'
import { MemoryAssetStore } from './memoryAssetStore.ts'

const bytes = new TextEncoder().encode('BestCode R2 adapter')
const sha = await sha256Hex(bytes)
const ref = { projectId: 'bestcode', assetId: 'asset-file-0001', sha256: sha }
const options = { body: bytes, sha256: sha, sizeBytes: bytes.byteLength, mediaType: 'text/plain', filename: 'report.txt' }

test('asset storage unit: canonical keys and private download headers reject injection', () => {
  assert.equal(assetObjectKey(ref), `projects/bestcode/assets/asset-file-0001/${sha}`)
  assert.throws(() => assetObjectKey({ ...ref, projectId: '../escape' }), /project_id is invalid|path/)
  assert.throws(() => buildAssetContentDisposition('bad\r\nX-Test: yes.txt'), /path or control sequence/)
  const headers = buildPrivateAssetHeaders({
    provider: 'memory',
    access: 'private',
    key: assetObjectKey(ref),
    sha256: sha,
    sizeBytes: bytes.byteLength,
    mediaType: 'text/plain',
    filename: 'report.txt',
    etag: '"x"',
    uploadedAt: new Date().toISOString(),
    verification: 'local-sha256-and-size',
  })
  assert.equal(headers.get('Cache-Control'), 'private, no-store')
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.match(headers.get('Content-Disposition'), /^attachment;/)
})

test('asset storage unit: memory adapter implements put/get/head/delete with integrity verification', async () => {
  const store = new MemoryAssetStore()
  const stored = await store.put(ref, options)
  assert.equal(stored.verification, 'local-sha256-and-size')
  assert.equal((await store.head(ref)).sha256, sha)
  const fetched = await store.get(ref)
  assert.equal(new TextDecoder().decode(await new Response(fetched.body).arrayBuffer()), 'BestCode R2 adapter')
  assert.equal(fetched.headers.get('Content-Type'), 'text/plain')
  await assert.rejects(store.put(ref, { ...options, sizeBytes: bytes.byteLength + 1 }), /size mismatch/)
  await assert.rejects(store.put({ ...ref, sha256: 'a'.repeat(64) }, { ...options, sha256: 'a'.repeat(64) }), /SHA-256 mismatch/)
  await store.delete(ref)
  assert.equal(await store.get(ref), null)
})

test('asset storage integration: memory multipart supports resume, complete, and abort', async () => {
  const store = new MemoryAssetStore()
  const part1 = new Uint8Array(ASSET_MULTIPART_MIN_PART_BYTES)
  part1.fill(1)
  const part2 = new TextEncoder().encode('tail')
  const combined = new Uint8Array(part1.byteLength + part2.byteLength)
  combined.set(part1)
  combined.set(part2, part1.byteLength)
  const wholeSha = await sha256Hex(combined)
  const multipartRef = { projectId: 'bestcode', assetId: 'asset-video-0001', sha256: wholeSha }
  const multipartOptions = { sha256: wholeSha, sizeBytes: combined.byteLength, mediaType: 'video/mp4', filename: 'clip.mp4' }
  const upload = await store.createMultipartUpload(multipartRef, multipartOptions)
  const uploaded1 = await upload.uploadPart(1, part1, { sha256: await sha256Hex(part1), sizeBytes: part1.byteLength })
  const resumed = store.resumeMultipartUpload(multipartRef, upload.uploadId, multipartOptions)
  const uploaded2 = await resumed.uploadPart(2, part2, { sha256: await sha256Hex(part2), sizeBytes: part2.byteLength })
  const stored = await resumed.complete([uploaded2, uploaded1])
  assert.equal(stored.sizeBytes, combined.byteLength)
  assert.equal(stored.sha256, wholeSha)
  assert.equal((await store.head(multipartRef)).mediaType, 'video/mp4')

  const abortedRef = { ...multipartRef, assetId: 'asset-video-0002' }
  const aborted = await store.createMultipartUpload(abortedRef, multipartOptions)
  await aborted.abort()
  assert.throws(() => store.resumeMultipartUpload(abortedRef, aborted.uploadId, multipartOptions), /not found/)
})
