import {
  assetReferenceSummary,
  linkAssetDefaults,
  recordAssetEvent,
} from './assetLifecycle'
import {
  assetCreateFingerprint,
  assetFromBrainObject,
  assetToBrainObject,
  buildAssetDuplicateKey,
  buildAssetIdempotencyKey,
  DEFAULT_MAX_ASSET_BYTES,
  normalizeAssetCreate,
  normalizeAssetUpdate,
  type AssetMetadata,
  type AssetPolicy,
} from './assetSchema'
import type { BrainObject } from './brainSchema'

interface AssetIndexEntry {
  object_id: string
  fingerprint: string
}

type ReadObject = (objectId: string) => Promise<BrainObject | null>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function objectKey(object: Pick<BrainObject, 'project_id' | 'kind' | 'object_id'>): string {
  return `brain-object:${object.project_id}:${object.kind}:${object.object_id}`
}

function objectLookupKey(objectId: string): string {
  return `brain-object-id:${objectId}`
}

function validIdentifier(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{3,64}$/.test(value)
}

function boundedLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), max)
}

function assetPolicy(request: Request): AssetPolicy {
  const parsed = Number(request.headers.get('X-BestCode-Asset-Max-Bytes') ?? DEFAULT_MAX_ASSET_BYTES)
  return { max_size_bytes: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ASSET_BYTES }
}

async function readAsset(readObject: ReadObject, assetId: string): Promise<AssetMetadata | null> {
  const object = await readObject(assetId)
  if (!object || object.kind !== 'asset') return null
  try {
    return assetFromBrainObject(object)
  } catch {
    return null
  }
}

async function listAssets(state: DurableObjectState, url: URL): Promise<Response> {
  const projectId = url.searchParams.get('project_id')
  if (!validIdentifier(projectId)) return json({ error: 'A valid project_id is required' }, 400)
  const missionId = url.searchParams.get('mission_id')
  if (missionId && !validIdentifier(missionId)) return json({ error: 'Invalid mission_id' }, 400)
  const sourceId = url.searchParams.get('source_id')
  if (sourceId && !validIdentifier(sourceId)) return json({ error: 'Invalid source_id' }, 400)
  const assetKind = url.searchParams.get('asset_kind')
  const uploadStatus = url.searchParams.get('upload_status')
  const processingStatus = url.searchParams.get('processing_status')
  const origin = url.searchParams.get('origin')
  const limit = boundedLimit(url.searchParams.get('limit'), 50, 200)
  const values = await state.storage.list<BrainObject>({ prefix: `brain-object:${projectId}:asset:` })
  const items = [...values.values()]
    .flatMap((object) => {
      try {
        return [assetFromBrainObject(object)]
      } catch {
        return []
      }
    })
    .filter((asset) =>
      (!missionId || asset.mission_id === missionId) &&
      (!sourceId || asset.source_id === sourceId) &&
      (!assetKind || asset.asset_kind === assetKind) &&
      (!uploadStatus || asset.upload_status === uploadStatus) &&
      (!processingStatus || asset.processing_status === processingStatus) &&
      (!origin || asset.origin === origin))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  return json({ items: items.slice(0, limit), count: Math.min(items.length, limit), total: items.length })
}

async function lifecyclePayload(
  state: DurableObjectState,
  asset: AssetMetadata,
  rawInput: unknown,
  readObject: ReadObject,
) {
  const links = await linkAssetDefaults(state, asset, rawInput, readObject)
  const references = await assetReferenceSummary(state, asset)
  return { links, references }
}

async function createAsset(request: Request, state: DurableObjectState, readObject: ReadObject): Promise<Response> {
  const rawInput = await request.json().catch(() => null)
  const asset = normalizeAssetCreate(rawInput, new Date().toISOString(), assetPolicy(request))
  const fingerprint = assetCreateFingerprint(asset)
  const existingById = await readAsset(readObject, asset.asset_id)
  if (existingById) {
    if (assetCreateFingerprint(existingById) === fingerprint) {
      const lifecycle = await lifecyclePayload(state, existingById, rawInput, readObject)
      return json({ asset: existingById, created: false, duplicate: false, idempotent: true, ...lifecycle })
    }
    return json({ error: 'Asset id already exists with different metadata' }, 409)
  }

  const idempotencyStorageKey = buildAssetIdempotencyKey(asset.project_id, asset.idempotency_key)
  const idempotency = await state.storage.get<AssetIndexEntry>(idempotencyStorageKey)
  if (idempotency) {
    const existing = await readAsset(readObject, idempotency.object_id)
    if (!existing) {
      await state.storage.delete(idempotencyStorageKey)
    } else if (idempotency.fingerprint === fingerprint) {
      const lifecycle = await lifecyclePayload(state, existing, rawInput, readObject)
      return json({ asset: existing, created: false, duplicate: false, idempotent: true, ...lifecycle })
    } else {
      return json({ error: 'Idempotency key was already used for different asset metadata' }, 409)
    }
  }

  const duplicateStorageKey = buildAssetDuplicateKey(asset.project_id, asset.sha256, asset.size_bytes)
  const duplicate = await state.storage.get<AssetIndexEntry>(duplicateStorageKey)
  if (duplicate) {
    const existing = await readAsset(readObject, duplicate.object_id)
    if (!existing) {
      await state.storage.delete(duplicateStorageKey)
    } else if (existing.upload_status === 'deleted') {
      return json({ error: 'A matching deleted asset exists and requires an explicit restore or re-upload decision' }, 409)
    } else {
      const lifecycle = await lifecyclePayload(state, existing, rawInput, readObject)
      await recordAssetEvent(
        state,
        existing,
        'asset_reused',
        asset.created_by,
        'Existing asset binary reused for a new Second Brain relationship.',
        {
          requested_asset_id: asset.asset_id,
          requested_mission_id: asset.mission_id,
          requested_source_id: asset.source_id,
          relation_ids: lifecycle.links.relations.map((relation) => relation.relation_id),
          binary_created: false,
        },
        asset.idempotency_key,
      )
      return json({
        asset: existing,
        created: false,
        duplicate: true,
        idempotent: false,
        reused_asset_id: existing.asset_id,
        binary_created: false,
        ...lifecycle,
      })
    }
  }

  const object = assetToBrainObject(asset)
  const key = objectKey(object)
  const index: AssetIndexEntry = { object_id: asset.asset_id, fingerprint }
  await state.storage.put(key, object)
  await state.storage.put(objectLookupKey(asset.asset_id), key)
  await state.storage.put(duplicateStorageKey, index)
  await state.storage.put(idempotencyStorageKey, index)
  await recordAssetEvent(
    state,
    asset,
    'asset_registered',
    asset.created_by,
    'Asset metadata registered in Second Brain.',
    { upload_status: asset.upload_status, storage_provider: asset.storage_provider },
  )
  const lifecycle = await lifecyclePayload(state, asset, rawInput, readObject)
  return json({ asset, created: true, duplicate: false, idempotent: false, ...lifecycle }, 201)
}

async function updateAsset(
  assetId: string,
  request: Request,
  state: DurableObjectState,
  readObject: ReadObject,
): Promise<Response> {
  const current = await readAsset(readObject, assetId)
  if (!current) return json({ error: 'Asset not found' }, 404)
  const updated = normalizeAssetUpdate(
    current,
    await request.json().catch(() => null),
    new Date().toISOString(),
    assetPolicy(request),
  )
  if (updated.version === current.version) return json({ asset: current, idempotent: true })
  const object = assetToBrainObject(updated)
  await state.storage.put(objectKey(object), object)
  return json({ asset: updated, idempotent: false })
}

export async function handleAssetStore(
  request: Request,
  state: DurableObjectState,
  readObject: ReadObject,
): Promise<Response | null> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean)
  if (request.method === 'POST' && url.pathname === '/assets') return createAsset(request, state, readObject)
  if (request.method === 'GET' && url.pathname === '/assets') return listAssets(state, url)
  if (segments[0] !== 'assets' || !segments[1]) return null
  const assetId = segments[1]
  if (!validIdentifier(assetId)) return json({ error: 'Invalid asset id' }, 400)
  if (request.method === 'GET' && segments.length === 2) {
    const asset = await readAsset(readObject, assetId)
    return asset ? json(asset) : json({ error: 'Asset not found' }, 404)
  }
  if (request.method === 'POST' && segments[2] === 'update') return updateAsset(assetId, request, state, readObject)
  return null
}
