import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { runProductionSmoke } from './r2-production-smoke.mjs'

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('production R2 smoke verifies private lifecycle, duplicate reuse, and cleanup', async () => {
  const calls = []
  let asset = null
  let bytes = null
  let deleted = false
  const fetchImpl = async (url, init = {}) => {
    const requestUrl = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ path: requestUrl.pathname, method, authorization: init.headers?.Authorization })
    assert.equal(init.headers?.Authorization, 'Bearer owner-token')

    if (requestUrl.pathname === '/api/brain/assets' && method === 'POST') {
      const body = JSON.parse(init.body)
      if (!asset) {
        asset = { ...body, upload_status: 'pending', storage_provider: 'unassigned', storage_key: null, version: 1 }
        return json(201, { asset, created: true, duplicate: false, idempotent: false })
      }
      return json(200, { asset, created: false, duplicate: true, idempotent: false, reused_asset_id: asset.asset_id })
    }

    if (requestUrl.pathname === `/api/brain/assets/${asset.asset_id}/content` && method === 'PUT') {
      bytes = new Uint8Array(init.body)
      asset = { ...asset, upload_status: 'stored', storage_provider: 'r2', storage_key: `projects/bestcode/assets/${asset.asset_id}/${asset.sha256}`, version: 3 }
      return json(201, {
        asset,
        object: { sha256: sha256(bytes), sizeBytes: bytes.byteLength, key: asset.storage_key },
        created: true,
        idempotent: false,
      })
    }

    const contentPath = asset ? `/api/brain/assets/${asset.asset_id}/content` : ''
    if (requestUrl.pathname === contentPath && method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `attachment; filename="${asset.filename}"`,
          'Content-Length': String(bytes.byteLength),
        },
      })
    }
    if (requestUrl.pathname === contentPath && method === 'GET') {
      if (deleted) return json(404, { error: 'Asset binary content is not stored' })
      return new Response(bytes, {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    }
    if (requestUrl.pathname === contentPath && method === 'DELETE') {
      deleted = true
      asset = { ...asset, upload_status: 'deleted', version: 4 }
      return json(200, { asset, deleted: true, idempotent: false })
    }
    if (asset && requestUrl.pathname === `/api/brain/assets/${asset.asset_id}` && method === 'GET') {
      return json(200, asset)
    }
    throw new Error(`Unexpected request ${method} ${requestUrl.pathname}`)
  }

  const evidence = await runProductionSmoke({
    baseUrl: 'https://bestcode.test',
    token: 'owner-token',
    runKey: 'run-123-1',
    fetchImpl,
  })

  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.checks.download_verified, true)
  assert.equal(evidence.checks.duplicate_reused, true)
  assert.equal(evidence.cleanup.attempted, true)
  assert.equal(evidence.cleanup.deleted, true)
  assert.equal(evidence.cleanup.get_after_delete_status, 404)
  assert.equal(evidence.cleanup.metadata_status, 'deleted')
  assert.ok(calls.some((call) => call.method === 'PUT'))
  assert.ok(calls.some((call) => call.method === 'HEAD'))
  assert.ok(calls.some((call) => call.method === 'DELETE'))
})

test('production R2 smoke still deletes the asset when download verification fails', async () => {
  let asset = null
  let deleted = false
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname
    const method = init.method ?? 'GET'
    if (path === '/api/brain/assets' && method === 'POST') {
      const body = JSON.parse(init.body)
      if (!asset) {
        asset = { ...body, upload_status: 'pending', storage_provider: 'unassigned', storage_key: null, version: 1 }
        return json(201, { asset, created: true })
      }
      return json(200, { asset, duplicate: true, reused_asset_id: asset.asset_id })
    }
    const contentPath = asset ? `/api/brain/assets/${asset.asset_id}/content` : ''
    if (path === contentPath && method === 'PUT') {
      const fixture = new Uint8Array(init.body)
      asset = { ...asset, upload_status: 'stored', storage_provider: 'r2', storage_key: 'canonical', version: 3 }
      return json(201, { asset, object: { sha256: asset.sha256, sizeBytes: fixture.byteLength } })
    }
    if (path === contentPath && method === 'HEAD') {
      return new Response(null, { status: 200, headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'attachment; filename="fixture.bin"',
        'Content-Length': String(asset.size_bytes),
      } })
    }
    if (path === contentPath && method === 'GET') {
      if (deleted) return json(404, { error: 'missing' })
      return new Response(new TextEncoder().encode('corrupt'), { status: 200, headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      } })
    }
    if (path === contentPath && method === 'DELETE') {
      deleted = true
      asset = { ...asset, upload_status: 'deleted', version: 4 }
      return json(200, { asset, deleted: true })
    }
    if (asset && path === `/api/brain/assets/${asset.asset_id}` && method === 'GET') return json(200, asset)
    throw new Error(`Unexpected request ${method} ${path}`)
  }

  await assert.rejects(
    runProductionSmoke({ baseUrl: 'https://bestcode.test', token: 'owner-token', runKey: 'run-corrupt-1', fetchImpl }),
    /Downloaded fixture size mismatch|SHA-256 mismatch/,
  )
  assert.equal(deleted, true)
  assert.equal(asset.upload_status, 'deleted')
})
