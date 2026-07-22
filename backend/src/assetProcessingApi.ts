import {
  PROCESSING_JOB_SCHEMA_VERSION,
  PROCESSING_RESULT_SCHEMA_VERSION,
  normalizeProcessingResult,
  processingJobFromAttributes,
  processingResultFromAttributes,
  type AssetProcessingJob,
  type AssetProcessingJobStatus,
  type AssetProcessingResult,
} from './assetProcessingSchema'
import { type AssetMetadata } from './assetSchema'
import { assetObjectKey, sha256Hex } from './assetStorage'
import { requireR2AssetStore } from './r2AssetStore'
import type { BrainObject } from './brainSchema'
import type { Env } from './types'
import {
  VisionPolicyError,
  imagePolicy,
  inspectImage,
  processingTimeoutMs,
  resolveVisionProcessor,
  type VisionProcessor,
} from './visionProcessor'

const PROCESS_PATH = /^\/api\/brain\/assets\/([A-Za-z0-9._:-]{3,64})\/process$/
const RETRY_PATH = /^\/api\/brain\/assets\/([A-Za-z0-9._:-]{3,64})\/process\/retry$/
const STATUS_PATH = /^\/api\/brain\/assets\/([A-Za-z0-9._:-]{3,64})\/processing$/
const RESULT_PATH = /^\/api\/brain\/assets\/([A-Za-z0-9._:-]{3,64})\/processing\/result$/
const ID_PATTERN = /^[A-Za-z0-9._:-]{3,64}$/

interface ProcessingDependencies {
  processor?: VisionProcessor | null
  now?: () => string
  timeoutMs?: number
}

class ProcessingHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function brainStub(env: Env): DurableObjectStub {
  if (!env.BRAIN_STORE) throw new ProcessingHttpError(503, 'brain_store_not_configured')
  return env.BRAIN_STORE.get(env.BRAIN_STORE.idFromName('bestcode-brain-v2'))
}

async function responseError(response: Response, fallback: string): Promise<ProcessingHttpError> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  const raw = typeof body?.error === 'string' ? body.error : fallback
  if (response.status === 404) return new ProcessingHttpError(404, 'not_found')
  if (response.status === 409 || /already exists|version mismatch|same project/i.test(raw)) return new ProcessingHttpError(409, 'brain_conflict')
  if (response.status >= 400 && response.status < 500) return new ProcessingHttpError(response.status, 'brain_request_invalid')
  return new ProcessingHttpError(502, 'brain_request_failed')
}

async function brainRequest(env: Env, path: string, init?: RequestInit, fallback = 'Brain request failed'): Promise<Response> {
  const response = await brainStub(env).fetch(new Request(`https://brain-store${path}`, init))
  if (!response.ok) throw await responseError(response, fallback)
  return response
}

async function readAsset(env: Env, assetId: string): Promise<AssetMetadata> {
  const response = await brainRequest(env, `/assets/${encodeURIComponent(assetId)}`)
  return response.json() as Promise<AssetMetadata>
}

async function readObject(env: Env, objectId: string): Promise<BrainObject | null> {
  const response = await brainStub(env).fetch(new Request(`https://brain-store/objects/${encodeURIComponent(objectId)}`))
  if (response.status === 404) return null
  if (!response.ok) throw await responseError(response, 'Brain object read failed')
  return response.json() as Promise<BrainObject>
}

async function createObjectIdempotent(env: Env, body: Record<string, unknown>): Promise<BrainObject> {
  const objectId = String(body.object_id)
  const existing = await readObject(env, objectId)
  if (existing) return existing
  const response = await brainStub(env).fetch(new Request('https://brain-store/objects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  if (response.status === 409) {
    const raced = await readObject(env, objectId)
    if (raced) return raced
  }
  if (!response.ok) throw await responseError(response, 'Brain object create failed')
  return response.json() as Promise<BrainObject>
}

async function updateObject(env: Env, current: BrainObject, body: Record<string, unknown>): Promise<BrainObject> {
  const response = await brainRequest(env, `/objects/${encodeURIComponent(current.object_id)}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: current.version, ...body }),
  })
  return response.json() as Promise<BrainObject>
}

async function updateAssetStatus(env: Env, assetId: string, status: AssetMetadata['processing_status']): Promise<AssetMetadata> {
  const current = await readAsset(env, assetId)
  if (current.processing_status === status) return current
  const response = await brainRequest(env, `/assets/${encodeURIComponent(assetId)}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: current.version, processing_status: status }),
  })
  const payload = await response.json() as { asset?: AssetMetadata }
  if (!payload.asset) throw new ProcessingHttpError(502, 'asset_update_failed')
  return payload.asset
}

async function digestId(prefix: string, value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const hex = [...digest].map((item) => item.toString(16).padStart(2, '0')).join('')
  return `${prefix}:${hex.slice(0, 48)}`
}

function projectIdFromRequest(request: Request, url: URL, body?: Record<string, unknown> | null): string {
  const value = body?.project_id ?? url.searchParams.get('project_id') ?? request.headers.get('X-BestCode-Project-Id')
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new ProcessingHttpError(400, 'valid_project_id_required')
  return value
}

function assertProcessableAsset(asset: AssetMetadata, projectId: string): void {
  if (asset.project_id !== projectId) throw new ProcessingHttpError(403, 'cross_project_access_denied')
  if (asset.upload_status === 'deleted') throw new ProcessingHttpError(409, 'deleted_asset_not_processable')
  if (asset.upload_status === 'failed') throw new ProcessingHttpError(409, 'failed_asset_not_processable')
  if (asset.upload_status !== 'stored') throw new ProcessingHttpError(409, 'asset_binary_not_stored')
  if (asset.asset_kind !== 'image') throw new ProcessingHttpError(415, 'unsupported_media_type')
}

function jobFromObject(object: BrainObject | null): AssetProcessingJob | null {
  return object?.kind === 'agent_run' ? processingJobFromAttributes(object.attributes) : null
}

async function listJobs(env: Env, asset: AssetMetadata): Promise<Array<{ object: BrainObject; job: AssetProcessingJob }>> {
  const response = await brainRequest(env, `/objects?project_id=${encodeURIComponent(asset.project_id)}&kind=agent_run&limit=200`)
  const payload = await response.json() as { items?: BrainObject[] }
  return (payload.items ?? [])
    .flatMap((object) => {
      const job = jobFromObject(object)
      return job?.asset_id === asset.asset_id ? [{ object, job }] : []
    })
    .sort((a, b) => Date.parse(b.job.updated_at) - Date.parse(a.job.updated_at))
}

function jobAttributes(job: AssetProcessingJob): Record<string, unknown> {
  return { processing_schema: PROCESSING_JOB_SCHEMA_VERSION, job }
}

async function createJob(
  env: Env,
  asset: AssetMetadata,
  processor: { name: string; version: string },
  now: string,
): Promise<{ object: BrainObject; job: AssetProcessingJob; created: boolean }> {
  const cacheKey = `${asset.sha256}:${processor.name}:${processor.version}`
  const jobId = await digestId('apj', `${asset.project_id}:${asset.asset_id}:${cacheKey}`)
  const existingObject = await readObject(env, jobId)
  const existingJob = jobFromObject(existingObject)
  if (existingObject && existingJob) return { object: existingObject, job: existingJob, created: false }
  const job: AssetProcessingJob = {
    schema: PROCESSING_JOB_SCHEMA_VERSION,
    job_id: jobId,
    asset_id: asset.asset_id,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    status: 'queued',
    attempt_count: 1,
    processor_name: processor.name,
    processor_version: processor.version,
    started_at: null,
    completed_at: null,
    safe_error_code: null,
    idempotency_key: cacheKey,
    cache_key: cacheKey,
    source_checksum: asset.sha256,
    result_object_id: null,
    created_at: now,
    updated_at: now,
  }
  const object = await createObjectIdempotent(env, {
    object_id: jobId,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    kind: 'agent_run',
    title: `Attachment processing: ${asset.display_name}`,
    body: null,
    attributes: jobAttributes(job),
    source_ids: asset.source_id ? [asset.source_id] : [],
    truth_status: 'interpreted',
    sensitivity: asset.sensitivity,
    retention: 'project',
    created_by: 'bestcode-attachment-processing',
    created_at: now,
  })
  return { object, job: jobFromObject(object) ?? job, created: true }
}

async function persistJob(
  env: Env,
  object: BrainObject,
  job: AssetProcessingJob,
  patch: Partial<AssetProcessingJob>,
  now: string,
): Promise<{ object: BrainObject; job: AssetProcessingJob }> {
  const updated: AssetProcessingJob = { ...job, ...patch, updated_at: now }
  const updatedObject = await updateObject(env, object, { attributes: jobAttributes(updated) })
  return { object: updatedObject, job: jobFromObject(updatedObject) ?? updated }
}

async function recordEvent(
  env: Env,
  asset: AssetMetadata,
  job: AssetProcessingJob,
  eventType: 'processing_queued' | 'processing_started' | 'processing_ready' | 'processing_failed',
  objectId: string,
  now: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const eventId = await digestId('ape', `${job.job_id}:${eventType}:${job.attempt_count}`)
  await brainRequest(env, '/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
      project_id: asset.project_id,
      mission_id: asset.mission_id,
      object_id: objectId,
      event_type: eventType,
      actor_id: 'bestcode-attachment-processing',
      summary: eventType.replaceAll('_', ' '),
      details: {
        contract: PROCESSING_JOB_SCHEMA_VERSION,
        asset_id: asset.asset_id,
        job_id: job.job_id,
        processor_name: job.processor_name,
        processor_version: job.processor_version,
        provider_neutral: true,
        ...details,
      },
      occurred_at: now,
    }),
  })
}

async function putRelation(
  env: Env,
  asset: AssetMetadata,
  fromObjectId: string,
  toObjectId: string,
  relationType: 'derived_from' | 'produced_by',
  token: string,
  now: string,
): Promise<void> {
  const relationId = await digestId('apr', `${asset.project_id}:${fromObjectId}:${relationType}:${toObjectId}:${token}`)
  await brainRequest(env, '/relations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      relation_id: relationId,
      project_id: asset.project_id,
      mission_id: asset.mission_id,
      from_object_id: fromObjectId,
      to_object_id: toObjectId,
      relation_type: relationType,
      attributes: {
        contract: 'asset-processing-relation-v1',
        provider_neutral: true,
        source_checksum: asset.sha256,
      },
      created_by: 'bestcode-attachment-processing',
      created_at: now,
    }),
  })
}

async function createResult(
  env: Env,
  asset: AssetMetadata,
  job: AssetProcessingJob,
  result: AssetProcessingResult,
): Promise<BrainObject> {
  const resultId = await digestId('apx', `${asset.project_id}:${asset.asset_id}:${job.cache_key}`)
  const object = await createObjectIdempotent(env, {
    object_id: resultId,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    kind: 'evidence',
    title: `Processed content: ${asset.display_name}`,
    body: result.summary,
    attributes: { processing_schema: PROCESSING_RESULT_SCHEMA_VERSION, result },
    source_ids: asset.source_id ? [asset.source_id] : [],
    truth_status: 'interpreted',
    sensitivity: asset.sensitivity,
    retention: 'project',
    created_by: 'bestcode-attachment-processing',
    created_at: result.created_at,
  })
  await putRelation(env, asset, resultId, asset.asset_id, 'derived_from', job.cache_key, result.created_at)
  await putRelation(env, asset, resultId, job.job_id, 'produced_by', job.cache_key, result.created_at)
  return object
}

function safeFailure(error: unknown): { status: AssetProcessingJobStatus; code: string; httpStatus: number } {
  if (error instanceof VisionPolicyError) {
    const unsupported = ['unsupported_media_type', 'animated_image_unsupported'].includes(error.code)
    return { status: unsupported ? 'unsupported' : 'failed', code: error.code, httpStatus: unsupported ? 415 : 422 }
  }
  if (error instanceof ProcessingHttpError) return { status: 'failed', code: error.code, httpStatus: error.status }
  if (error instanceof DOMException && error.name === 'AbortError') return { status: 'failed', code: 'provider_timeout', httpStatus: 504 }
  return { status: 'failed', code: 'provider_failure', httpStatus: 502 }
}

async function runWithTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await operation(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function execute(
  request: Request,
  env: Env,
  url: URL,
  assetId: string,
  retry: boolean,
  dependencies: ProcessingDependencies,
): Promise<Response> {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const projectId = projectIdFromRequest(request, url, body)
  const now = dependencies.now?.() ?? new Date().toISOString()
  const asset = await readAsset(env, assetId)
  assertProcessableAsset(asset, projectId)

  const processor = dependencies.processor === undefined ? resolveVisionProcessor(env) : dependencies.processor
  const identity = processor ?? { name: 'unconfigured-vision', version: env.VISION_PROCESSOR_VERSION?.trim() || '0' }
  let state: { object: BrainObject; job: AssetProcessingJob; created?: boolean } = await createJob(env, asset, identity, now)

  if (state.job.status === 'ready') {
    return json({ asset, job: state.job, idempotent: true, cached: true, result_object_id: state.job.result_object_id })
  }
  if (!retry && state.job.status === 'processing') return json({ asset, job: state.job, idempotent: true }, 202)
  if (!retry && (state.job.status === 'failed' || state.job.status === 'unsupported')) {
    return json({ asset, job: state.job, error: { code: state.job.safe_error_code } }, 409)
  }
  if (retry && !state.created) {
    if (!['failed', 'unsupported'].includes(state.job.status)) {
      throw new ProcessingHttpError(409, 'retry_requires_failed_or_unsupported_job')
    }
    state = await persistJob(env, state.object, state.job, {
      status: 'queued',
      attempt_count: state.job.attempt_count + 1,
      started_at: null,
      completed_at: null,
      safe_error_code: null,
      result_object_id: null,
    }, now)
  }

  if (state.created || retry) {
    await updateAssetStatus(env, assetId, 'queued')
    await recordEvent(env, asset, state.job, 'processing_queued', state.job.job_id, now)
  }

  try {
    state = await persistJob(env, state.object, state.job, { status: 'processing', started_at: now }, now)
    await updateAssetStatus(env, assetId, 'processing')
    await recordEvent(env, asset, state.job, 'processing_started', state.job.job_id, now)

    if (!processor) throw new ProcessingHttpError(503, 'vision_provider_not_configured')

    const ref = { projectId: asset.project_id, assetId: asset.asset_id, sha256: asset.sha256 }
    if (asset.storage_key !== assetObjectKey(ref) || asset.storage_provider !== 'r2') {
      throw new ProcessingHttpError(409, 'canonical_storage_contract_mismatch')
    }
    const stored = await requireR2AssetStore(env).get(ref)
    if (!stored) throw new ProcessingHttpError(409, 'r2_object_missing')
    if (stored.sizeBytes !== asset.size_bytes) throw new ProcessingHttpError(422, 'r2_size_mismatch')
    if (stored.mediaType !== asset.media_type) throw new ProcessingHttpError(415, 'r2_mime_mismatch')
    if (stored.sha256 !== asset.sha256) throw new ProcessingHttpError(422, 'r2_checksum_metadata_mismatch')
    const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer())
    if (bytes.byteLength !== asset.size_bytes) throw new ProcessingHttpError(422, 'r2_size_mismatch')
    if (await sha256Hex(bytes) !== asset.sha256) throw new ProcessingHttpError(422, 'sha256_mismatch')
    const image = inspectImage(bytes, asset.media_type, imagePolicy(env))

    const output = await runWithTimeout((signal) => processor.process({
      assetId: asset.asset_id,
      projectId: asset.project_id,
      mediaType: asset.media_type,
      filename: asset.filename,
      sha256: asset.sha256,
      bytes,
      image,
    }, signal), dependencies.timeoutMs ?? processingTimeoutMs(env))
    const result = normalizeProcessingResult(asset, processor, output, now)
    const resultObject = await createResult(env, asset, state.job, result)
    state = await persistJob(env, state.object, state.job, {
      status: 'ready',
      completed_at: now,
      safe_error_code: null,
      result_object_id: resultObject.object_id,
    }, now)
    const updatedAsset = await updateAssetStatus(env, assetId, 'ready')
    await recordEvent(env, updatedAsset, state.job, 'processing_ready', resultObject.object_id, now, {
      result_object_id: resultObject.object_id,
      source_checksum: result.source_checksum,
    })
    return json({ asset: updatedAsset, job: state.job, result, result_object_id: resultObject.object_id, idempotent: false }, 201)
  } catch (error) {
    const failure = safeFailure(error)
    state = await persistJob(env, state.object, state.job, {
      status: failure.status,
      completed_at: now,
      safe_error_code: failure.code,
      result_object_id: null,
    }, now)
    const updatedAsset = await updateAssetStatus(env, assetId, failure.status === 'unsupported' ? 'unsupported' : 'failed')
    await recordEvent(env, updatedAsset, state.job, 'processing_failed', state.job.job_id, now, { safe_error_code: failure.code })
    return json({ asset: updatedAsset, job: state.job, error: { code: failure.code } }, failure.httpStatus)
  }
}

async function statusResponse(request: Request, env: Env, url: URL, assetId: string): Promise<Response> {
  const projectId = projectIdFromRequest(request, url)
  const asset = await readAsset(env, assetId)
  if (asset.project_id !== projectId) throw new ProcessingHttpError(403, 'cross_project_access_denied')
  const latest = (await listJobs(env, asset))[0] ?? null
  return json({ asset, status: latest?.job.status ?? asset.processing_status, job: latest?.job ?? null })
}

async function resultResponse(request: Request, env: Env, url: URL, assetId: string): Promise<Response> {
  const projectId = projectIdFromRequest(request, url)
  const asset = await readAsset(env, assetId)
  if (asset.project_id !== projectId) throw new ProcessingHttpError(403, 'cross_project_access_denied')
  const ready = (await listJobs(env, asset)).find((item) => item.job.status === 'ready' && item.job.result_object_id)
  if (!ready?.job.result_object_id) throw new ProcessingHttpError(404, 'processing_result_not_ready')
  const object = await readObject(env, ready.job.result_object_id)
  const result = object?.kind === 'evidence' ? processingResultFromAttributes(object.attributes) : null
  if (!result || result.asset_id !== asset.asset_id || result.project_id !== asset.project_id || result.source_checksum !== asset.sha256) {
    throw new ProcessingHttpError(409, 'processing_result_integrity_mismatch')
  }
  return json({ asset, job: ready.job, result, result_object_id: object?.object_id })
}

export async function handleAssetProcessingApi(
  request: Request,
  env: Env,
  url = new URL(request.url),
  dependencies: ProcessingDependencies = {},
): Promise<Response | null> {
  const processMatch = PROCESS_PATH.exec(url.pathname)
  const retryMatch = RETRY_PATH.exec(url.pathname)
  const statusMatch = STATUS_PATH.exec(url.pathname)
  const resultMatch = RESULT_PATH.exec(url.pathname)
  if (!processMatch && !retryMatch && !statusMatch && !resultMatch) return null

  try {
    if (processMatch && request.method === 'POST') return await execute(request, env, url, processMatch[1], false, dependencies)
    if (retryMatch && request.method === 'POST') return await execute(request, env, url, retryMatch[1], true, dependencies)
    if (statusMatch && request.method === 'GET') return await statusResponse(request, env, url, statusMatch[1])
    if (resultMatch && request.method === 'GET') return await resultResponse(request, env, url, resultMatch[1])
    return json({ error: { code: 'method_not_allowed' } }, 405)
  } catch (error) {
    const failure = safeFailure(error)
    return json({ error: { code: failure.code } }, failure.httpStatus)
  }
}
