import { normalizeAssetMediaType, type AssetMetadata } from './assetSchema'
import { assetObjectKey, buildPrivateAssetHeaders, type AssetObjectRef, type AssetStoredObject } from './assetStorage'
import { requireR2AssetStore, type R2AssetStore } from './r2AssetStore'
import type { Env } from './types'

const ASSET_CONTENT_PATH = /^\/api\/brain\/assets\/([A-Za-z0-9._:-]{3,64})\/content$/

class AssetBinaryHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function brainStub(env: Env): DurableObjectStub {
  if (!env.BRAIN_STORE) throw new AssetBinaryHttpError(503, 'Brain v2 storage is not configured')
  return env.BRAIN_STORE.get(env.BRAIN_STORE.idFromName('bestcode-brain-v2'))
}

async function responseError(response: Response, fallback: string): Promise<AssetBinaryHttpError> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  const message = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : fallback
  if (response.status === 404) return new AssetBinaryHttpError(404, message)
  if (/version mismatch|invalid upload status transition|already exists|conflict|reference/i.test(message)) {
    return new AssetBinaryHttpError(409, message)
  }
  if (response.status >= 400 && response.status < 500) return new AssetBinaryHttpError(response.status, message)
  return new AssetBinaryHttpError(502, message)
}

async function brainRequest(env: Env, path: string, init?: RequestInit, fallback = 'Brain request failed'): Promise<Response> {
  const response = await brainStub(env).fetch(new Request(`https://brain-store${path}`, init))
  if (!response.ok) throw await responseError(response, fallback)
  return response
}

async function readAsset(env: Env, assetId: string): Promise<AssetMetadata> {
  const response = await brainRequest(env, `/assets/${encodeURIComponent(assetId)}`, undefined, 'Asset metadata read failed')
  return response.json() as Promise<AssetMetadata>
}

async function updateAsset(
  env: Env,
  assetId: string,
  body: Record<string, unknown>,
): Promise<AssetMetadata> {
  const response = await brainRequest(env, `/assets/${encodeURIComponent(assetId)}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Asset metadata update failed')
  const result = await response.json() as { asset?: AssetMetadata }
  if (!result.asset) throw new AssetBinaryHttpError(502, 'Asset metadata update returned no asset')
  return result.asset
}

async function eventId(asset: AssetMetadata, eventType: string, token: string): Promise<string> {
  const value = `${asset.project_id}:${asset.asset_id}:${eventType}:${token}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const hex = [...digest].map((item) => item.toString(16).padStart(2, '0')).join('')
  return `ae:${hex.slice(0, 48)}`
}

async function recordLifecycleEvent(
  env: Env,
  asset: AssetMetadata,
  eventType: 'asset_uploaded' | 'asset_stored' | 'asset_deleted',
  summary: string,
  details: Record<string, unknown>,
  token = String(asset.version),
): Promise<void> {
  await brainRequest(env, '/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: await eventId(asset, eventType, token),
      project_id: asset.project_id,
      mission_id: asset.mission_id,
      object_id: asset.asset_id,
      event_type: eventType,
      actor_id: 'bestcode-asset-binary-api',
      summary,
      details: {
        contract: 'asset-event-v1',
        asset_id: asset.asset_id,
        provider_neutral: true,
        ...details,
      },
    }),
  }, `Asset lifecycle event ${eventType} could not be persisted`)
}

async function readReferenceSummary(env: Env, assetId: string): Promise<{
  active_reference_count: number
  total_relationship_count: number
  by_type: Record<string, number>
}> {
  const response = await brainRequest(
    env,
    `/assets/${encodeURIComponent(assetId)}/references`,
    undefined,
    'Asset reference count could not be verified',
  )
  const result = await response.json() as {
    active_reference_count?: unknown
    total_relationship_count?: unknown
    by_type?: unknown
  }
  const active = Number(result.active_reference_count)
  const total = Number(result.total_relationship_count)
  if (!Number.isSafeInteger(active) || active < 0 || !Number.isSafeInteger(total) || total < 0) {
    throw new AssetBinaryHttpError(502, 'Asset reference count response is invalid')
  }
  return {
    active_reference_count: active,
    total_relationship_count: total,
    by_type: result.by_type && typeof result.by_type === 'object' ? result.by_type as Record<string, number> : {},
  }
}

async function cleanupRelations(env: Env, assetId: string): Promise<void> {
  await brainRequest(env, `/assets/${encodeURIComponent(assetId)}/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, 'Deleted asset relationship cleanup failed')
}

function objectRef(asset: AssetMetadata): AssetObjectRef {
  return { projectId: asset.project_id, assetId: asset.asset_id, sha256: asset.sha256 }
}

function assertCanonicalMetadata(asset: AssetMetadata, ref: AssetObjectRef): string {
  const expectedKey = assetObjectKey(ref)
  if (asset.storage_key && asset.storage_key !== expectedKey) {
    throw new AssetBinaryHttpError(409, 'Asset metadata storage key is not canonical')
  }
  if (asset.upload_status === 'stored' && (asset.storage_provider !== 'r2' || asset.storage_key !== expectedKey)) {
    throw new AssetBinaryHttpError(409, 'Stored asset metadata is not bound to the canonical R2 object')
  }
  return expectedKey
}

function assertStoredObject(object: AssetStoredObject | null, asset: AssetMetadata, expectedKey: string): AssetStoredObject {
  if (!object) throw new AssetBinaryHttpError(409, 'Stored asset metadata exists but the R2 object is missing')
  if (object.key !== expectedKey || object.sha256 !== asset.sha256 || object.sizeBytes !== asset.size_bytes) {
    throw new AssetBinaryHttpError(409, 'R2 object does not match the asset metadata contract')
  }
  return object
}

function requireStore(env: Env): R2AssetStore {
  try {
    return requireR2AssetStore(env)
  } catch (error) {
    throw new AssetBinaryHttpError(503, error instanceof Error ? error.message : String(error))
  }
}

function declaredLength(request: Request, expected: number): void {
  const raw = request.headers.get('Content-Length')
  if (!raw) throw new AssetBinaryHttpError(411, 'Content-Length is required for binary upload')
  const size = Number(raw)
  if (!Number.isSafeInteger(size) || size < 0) throw new AssetBinaryHttpError(400, 'Content-Length is invalid')
  if (size !== expected) throw new AssetBinaryHttpError(422, `Asset size mismatch: expected ${expected}, received ${size}`)
}

function declaredMediaType(request: Request, expected: string): void {
  const raw = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim()
  if (!raw) throw new AssetBinaryHttpError(415, 'Content-Type is required for binary upload')
  let actual: string
  try {
    actual = normalizeAssetMediaType(raw)
  } catch (error) {
    throw new AssetBinaryHttpError(415, error instanceof Error ? error.message : String(error))
  }
  if (actual !== expected) throw new AssetBinaryHttpError(415, `Content-Type mismatch: expected ${expected}, received ${actual}`)
}

async function markFailed(env: Env, asset: AssetMetadata): Promise<void> {
  try {
    const latest = await readAsset(env, asset.asset_id)
    if (latest.upload_status === 'uploading') {
      await updateAsset(env, asset.asset_id, { expected_version: latest.version, upload_status: 'failed' })
    }
  } catch {
    // The caller still receives the original upload failure. A later retry can reconcile metadata.
  }
}

async function putContent(request: Request, env: Env, assetId: string): Promise<Response> {
  const current = await readAsset(env, assetId)
  const ref = objectRef(current)
  const expectedKey = assertCanonicalMetadata(current, ref)
  const store = requireStore(env)

  if (current.upload_status === 'stored') {
    const existing = assertStoredObject(await store.head(ref), current, expectedKey)
    await recordLifecycleEvent(env, current, 'asset_stored', 'Asset binary is stored and verified.', {
      storage_key: existing.key,
      size_bytes: existing.sizeBytes,
      sha256: existing.sha256,
      reused: true,
    })
    return json({ asset: current, object: existing, created: false, idempotent: true })
  }
  if (current.upload_status === 'deleted') throw new AssetBinaryHttpError(409, 'Deleted asset requires an explicit restore decision')
  if (current.upload_status === 'uploading') throw new AssetBinaryHttpError(409, 'Asset upload is already in progress')
  if (current.upload_status !== 'pending' && current.upload_status !== 'failed') {
    throw new AssetBinaryHttpError(409, `Asset upload status ${current.upload_status} cannot accept binary content`)
  }

  declaredLength(request, current.size_bytes)
  declaredMediaType(request, current.media_type)
  const uploading = await updateAsset(env, assetId, {
    expected_version: current.version,
    upload_status: 'uploading',
  })
  let completed: AssetMetadata | null = null

  try {
    const bytes = new Uint8Array(await request.arrayBuffer())
    const stored = await store.put(ref, {
      body: bytes,
      sha256: current.sha256,
      sizeBytes: current.size_bytes,
      mediaType: current.media_type,
      filename: current.filename,
    })
    assertStoredObject(await store.head(ref), current, expectedKey)
    await recordLifecycleEvent(env, uploading, 'asset_uploaded', 'Asset binary upload completed.', {
      storage_key: stored.key,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
    })
    completed = await updateAsset(env, assetId, {
      expected_version: uploading.version,
      upload_status: 'stored',
      storage_provider: 'r2',
      storage_key: stored.key,
    })
    await recordLifecycleEvent(env, completed, 'asset_stored', 'Asset binary stored with verified metadata parity.', {
      storage_key: stored.key,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
      reused: false,
    })
    return json({ asset: completed, object: stored, created: true, idempotent: false }, 201)
  } catch (error) {
    if (completed) throw error
    try {
      const latest = await readAsset(env, assetId)
      if (latest.upload_status === 'stored' && latest.storage_provider === 'r2' && latest.storage_key === expectedKey) {
        const recovered = assertStoredObject(await store.head(ref), latest, expectedKey)
        await recordLifecycleEvent(env, latest, 'asset_stored', 'Asset binary stored with verified metadata parity.', {
          storage_key: recovered.key,
          size_bytes: recovered.sizeBytes,
          sha256: recovered.sha256,
          recovered: true,
        })
        return json({ asset: latest, object: recovered, created: false, idempotent: true, recovered: true })
      }
    } catch {
      // Continue with cleanup when a committed stored state cannot be proven.
    }
    await store.delete(ref).catch(() => undefined)
    const remaining = await store.head(ref).catch(() => null)
    await markFailed(env, uploading)
    if (remaining) throw new AssetBinaryHttpError(500, 'Binary upload failed and R2 cleanup could not be verified')
    if (error instanceof AssetBinaryHttpError) throw error
    const message = error instanceof Error ? error.message : String(error)
    const status = /SHA-256 mismatch|size mismatch|checksum/i.test(message) ? 422 : 500
    throw new AssetBinaryHttpError(status, message)
  }
}

async function getContent(env: Env, assetId: string, headOnly: boolean): Promise<Response> {
  const asset = await readAsset(env, assetId)
  const ref = objectRef(asset)
  const expectedKey = assertCanonicalMetadata(asset, ref)
  if (asset.upload_status !== 'stored') throw new AssetBinaryHttpError(404, 'Asset binary content is not stored')
  const store = requireStore(env)
  if (headOnly) {
    const object = assertStoredObject(await store.head(ref), asset, expectedKey)
    return new Response(null, { status: 200, headers: buildPrivateAssetHeaders(object) })
  }
  const object = await store.get(ref)
  if (!object) throw new AssetBinaryHttpError(404, 'Asset binary content was not found')
  assertStoredObject(object, asset, expectedKey)
  return new Response(object.body, { status: 200, headers: object.headers })
}

async function deleteContent(env: Env, assetId: string): Promise<Response> {
  const current = await readAsset(env, assetId)
  const ref = objectRef(current)
  assertCanonicalMetadata(current, ref)
  const store = requireStore(env)

  if (current.upload_status === 'deleted') {
    await store.delete(ref)
    if (await store.head(ref)) throw new AssetBinaryHttpError(500, 'R2 delete could not be verified')
    await cleanupRelations(env, assetId)
    await recordLifecycleEvent(env, current, 'asset_deleted', 'Deleted asset cleanup verified.', {
      active_reference_count: 0,
      idempotent: true,
    })
    return json({ asset: current, deleted: true, idempotent: true })
  }

  const references = await readReferenceSummary(env, assetId)
  if (references.active_reference_count > 0) {
    throw new AssetBinaryHttpError(
      409,
      `Asset binary is still referenced by ${references.active_reference_count} active relationship(s)`,
    )
  }

  await store.delete(ref)
  if (await store.head(ref)) throw new AssetBinaryHttpError(500, 'R2 delete could not be verified')
  const deleted = await updateAsset(env, assetId, {
    expected_version: current.version,
    upload_status: 'deleted',
  })
  await cleanupRelations(env, assetId)
  await recordLifecycleEvent(env, deleted, 'asset_deleted', 'Asset binary and inactive relationships deleted.', {
    active_reference_count: references.active_reference_count,
    prior_relationship_count: references.total_relationship_count,
    reference_types: references.by_type,
    idempotent: false,
  })
  return json({ asset: deleted, deleted: true, idempotent: false })
}

export async function handleAssetBinaryApi(
  request: Request,
  env: Env,
  url = new URL(request.url),
): Promise<Response | null> {
  const match = ASSET_CONTENT_PATH.exec(url.pathname)
  if (!match) return null
  const assetId = match[1]
  try {
    if (request.method === 'PUT') return await putContent(request, env, assetId)
    if (request.method === 'GET') return await getContent(env, assetId, false)
    if (request.method === 'HEAD') return await getContent(env, assetId, true)
    if (request.method === 'DELETE') return await deleteContent(env, assetId)
    const response = json({ error: 'Method not allowed' }, 405)
    response.headers.set('Allow', 'PUT, GET, HEAD, DELETE')
    return response
  } catch (error) {
    if (error instanceof AssetBinaryHttpError) return json({ error: error.message }, error.status)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
}
