import type { BrainObject } from './brainSchema'

export const ASSET_SCHEMA_VERSION = 'asset-v1' as const
export const DEFAULT_MAX_ASSET_BYTES = 104_857_600

export type AssetKind =
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'text'
  | 'code'
  | 'archive'
  | 'document'
  | 'generated_artifact'
  | 'other'

export type AssetOrigin =
  | 'owner_upload'
  | 'ai_generated'
  | 'imported'
  | 'repository_export'
  | 'system_generated'

export type AssetUploadStatus = 'pending' | 'uploading' | 'stored' | 'failed' | 'deleted'
export type AssetProcessingStatus = 'not_requested' | 'queued' | 'processing' | 'ready' | 'failed' | 'unsupported'
export type AssetSensitivity = 'normal' | 'private'

export interface AssetPolicy {
  max_size_bytes: number
}

export interface AssetMetadata {
  schema: typeof ASSET_SCHEMA_VERSION
  asset_id: string
  project_id: string
  mission_id: string | null
  source_id: string | null
  filename: string
  display_name: string
  media_type: string
  asset_kind: AssetKind
  size_bytes: number
  sha256: string
  storage_provider: string
  storage_key: string | null
  upload_status: AssetUploadStatus
  processing_status: AssetProcessingStatus
  origin: AssetOrigin
  sensitivity: AssetSensitivity
  idempotency_key: string
  created_by: string
  created_at: string
  updated_at: string
  version: number
}

const ASSET_KINDS = new Set<AssetKind>([
  'image', 'pdf', 'audio', 'video', 'text', 'code', 'archive', 'document', 'generated_artifact', 'other',
])
const ORIGINS = new Set<AssetOrigin>([
  'owner_upload', 'ai_generated', 'imported', 'repository_export', 'system_generated',
])
const UPLOAD_STATUSES = new Set<AssetUploadStatus>(['pending', 'uploading', 'stored', 'failed', 'deleted'])
const PROCESSING_STATUSES = new Set<AssetProcessingStatus>([
  'not_requested', 'queued', 'processing', 'ready', 'failed', 'unsupported',
])
const SENSITIVITIES = new Set<AssetSensitivity>(['normal', 'private'])
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/
const DANGEROUS_BINARY_MIME = new Set([
  'application/x-dosexec',
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-msdos-program',
  'application/x-msdownload',
  'application/x-sharedlib',
  'application/vnd.microsoft.portable-executable',
])
const PATH_ESCAPE = /[\\/\u0000-\u001f\u007f]|%(?:2e|2f|5c)/i
const UNSAFE_FILENAME_CHARS = /[<>:"|?*&'`=]/g
const STORAGE_PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/
const ID_PATTERN = /^[A-Za-z0-9._:-]{3,64}$/

const UPLOAD_TRANSITIONS: Record<AssetUploadStatus, Set<AssetUploadStatus>> = {
  pending: new Set(['pending', 'uploading', 'failed', 'deleted']),
  uploading: new Set(['uploading', 'stored', 'failed', 'deleted']),
  stored: new Set(['stored', 'deleted']),
  failed: new Set(['failed', 'pending', 'uploading', 'deleted']),
  deleted: new Set(['deleted']),
}

const PROCESSING_TRANSITIONS: Record<AssetProcessingStatus, Set<AssetProcessingStatus>> = {
  not_requested: new Set(['not_requested', 'queued', 'unsupported']),
  queued: new Set(['queued', 'processing', 'failed', 'unsupported']),
  processing: new Set(['processing', 'ready', 'failed', 'unsupported']),
  ready: new Set(['ready', 'queued']),
  failed: new Set(['failed', 'queued', 'processing', 'unsupported']),
  unsupported: new Set(['unsupported', 'queued']),
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function cleanString(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    if (required) throw new Error('Required string is missing')
    return null
  }
  return value.trim().slice(0, max)
}

function identifier(value: unknown, name: string): string {
  const parsed = cleanString(value, 64, true) as string
  if (!ID_PATTERN.test(parsed)) throw new Error(`${name} is invalid`)
  return parsed
}

function isoDate(value: unknown, name: string, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = cleanString(value, 64, true) as string
  const timestamp = Date.parse(parsed)
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be an ISO date`)
  return new Date(timestamp).toISOString()
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T, name: string): T {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !values.has(value as T)) throw new Error(`${name} is invalid`)
  return value as T
}

function maxAssetBytes(policy?: Partial<AssetPolicy>): number {
  const value = policy?.max_size_bytes ?? DEFAULT_MAX_ASSET_BYTES
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Asset policy max_size_bytes is invalid')
  return value
}

export function sanitizeAssetFilename(value: unknown): string {
  const input = cleanString(value, 500, true) as string
  if (PATH_ESCAPE.test(input) || input === '.' || input === '..') throw new Error('filename contains a path or control sequence')
  const normalized = input
    .normalize('NFKC')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180)
  if (!normalized) throw new Error('filename is invalid after sanitization')
  return normalized
}

export function normalizeAssetMediaType(value: unknown): string {
  const mediaType = (cleanString(value, 127, true) as string).toLowerCase()
  if (!MIME_PATTERN.test(mediaType)) throw new Error('media_type is invalid')
  if (DANGEROUS_BINARY_MIME.has(mediaType)) throw new Error('media_type is not allowed')
  return mediaType
}

export function normalizeAssetSha256(value: unknown): string {
  const sha = (cleanString(value, 64, true) as string).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('sha256 must be a 64-character hexadecimal digest')
  return sha
}

function normalizeSize(value: unknown, policy?: Partial<AssetPolicy>): number {
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('size_bytes must be a non-negative safe integer')
  const max = maxAssetBytes(policy)
  if (size > max) throw new Error(`size_bytes exceeds the ${max}-byte asset policy`)
  return size
}

function inferAssetKind(mediaType: string): AssetKind {
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf') return 'pdf'
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('text/')) return 'text'
  if (['application/json', 'application/javascript', 'application/xml'].includes(mediaType)) return 'code'
  if (['application/zip', 'application/gzip', 'application/x-7z-compressed', 'application/x-rar-compressed', 'application/x-tar'].includes(mediaType)) return 'archive'
  if (/^(application\/(msword|rtf|vnd\.openxmlformats-officedocument|vnd\.oasis\.opendocument))/.test(mediaType)) return 'document'
  return 'other'
}

function assertKindMatchesMediaType(kind: AssetKind, mediaType: string): void {
  if (kind === 'generated_artifact' || kind === 'other') return
  const inferred = inferAssetKind(mediaType)
  if (kind === 'code' && (inferred === 'code' || inferred === 'text')) return
  if (kind === 'document' && (inferred === 'document' || inferred === 'text')) return
  if (kind !== inferred) throw new Error(`asset_kind ${kind} does not match media_type ${mediaType}`)
}

function normalizeProvider(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'unassigned'
  const provider = cleanString(value, 32, true) as string
  if (!STORAGE_PROVIDER_PATTERN.test(provider)) throw new Error('storage_provider is invalid')
  return provider
}

export function buildAssetStorageKey(projectId: string, assetId: string, sha256: string): string {
  return `projects/${identifier(projectId, 'project_id')}/assets/${identifier(assetId, 'asset_id')}/${normalizeAssetSha256(sha256)}`
}

export function buildAssetDuplicateKey(projectId: string, sha256: string, sizeBytes: number): string {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('size_bytes must be a non-negative safe integer')
  return `asset-duplicate:${identifier(projectId, 'project_id')}:${normalizeAssetSha256(sha256)}:${sizeBytes}`
}

export function buildAssetIdempotencyKey(projectId: string, idempotencyKey: string): string {
  return `asset-idempotency:${identifier(projectId, 'project_id')}:${identifier(idempotencyKey, 'idempotency_key')}`
}

function normalizeStorageKey(value: unknown, asset: Pick<AssetMetadata, 'project_id' | 'asset_id' | 'sha256'>): string | null {
  if (value === undefined || value === null || value === '') return null
  const key = cleanString(value, 240, true) as string
  const expected = buildAssetStorageKey(asset.project_id, asset.asset_id, asset.sha256)
  if (key !== expected) throw new Error('storage_key must use the canonical asset key contract')
  return key
}

function assertStateConsistency(asset: AssetMetadata): void {
  if (asset.upload_status === 'stored') {
    if (asset.storage_provider === 'unassigned' || !asset.storage_key) {
      throw new Error('upload_status=stored requires storage_provider and storage_key')
    }
  } else if (asset.upload_status !== 'deleted' && asset.storage_key) {
    throw new Error('storage_key is only allowed for stored or deleted assets')
  }
  if (
    asset.upload_status !== 'stored' &&
    asset.upload_status !== 'deleted' &&
    !['not_requested', 'failed'].includes(asset.processing_status)
  ) {
    throw new Error('processing requires a stored asset')
  }
  if (asset.asset_kind === 'generated_artifact' && !['ai_generated', 'system_generated', 'repository_export'].includes(asset.origin)) {
    throw new Error('generated_artifact requires generated provenance')
  }
}

export function normalizeAssetCreate(
  value: unknown,
  now = new Date().toISOString(),
  policy?: Partial<AssetPolicy>,
): AssetMetadata {
  const input = record(value)
  if (!input) throw new Error('Asset metadata body is required')
  const assetId = identifier(input.asset_id, 'asset_id')
  const projectId = identifier(input.project_id, 'project_id')
  const missionId = input.mission_id ? identifier(input.mission_id, 'mission_id') : null
  const sourceId = input.source_id ? identifier(input.source_id, 'source_id') : null
  const filename = sanitizeAssetFilename(input.filename)
  const displayName = input.display_name === undefined ? filename : sanitizeAssetFilename(input.display_name)
  const mediaType = normalizeAssetMediaType(input.media_type)
  const origin = enumValue(input.origin, ORIGINS, 'owner_upload', 'origin')
  const defaultKind = origin === 'ai_generated' || origin === 'system_generated' ? 'generated_artifact' : inferAssetKind(mediaType)
  const assetKind = enumValue(input.asset_kind, ASSET_KINDS, defaultKind, 'asset_kind')
  assertKindMatchesMediaType(assetKind, mediaType)
  const sizeBytes = normalizeSize(input.size_bytes, policy)
  const sha256 = normalizeAssetSha256(input.sha256)
  const createdAt = isoDate(input.created_at, 'created_at', now)
  const asset: AssetMetadata = {
    schema: ASSET_SCHEMA_VERSION,
    asset_id: assetId,
    project_id: projectId,
    mission_id: missionId,
    source_id: sourceId,
    filename,
    display_name: displayName,
    media_type: mediaType,
    asset_kind: assetKind,
    size_bytes: sizeBytes,
    sha256,
    storage_provider: normalizeProvider(input.storage_provider),
    storage_key: null,
    upload_status: enumValue(input.upload_status, UPLOAD_STATUSES, 'pending', 'upload_status'),
    processing_status: enumValue(input.processing_status, PROCESSING_STATUSES, 'not_requested', 'processing_status'),
    origin,
    sensitivity: enumValue(input.sensitivity, SENSITIVITIES, 'normal', 'sensitivity'),
    idempotency_key: input.idempotency_key ? identifier(input.idempotency_key, 'idempotency_key') : assetId,
    created_by: cleanString(input.created_by, 120, true) as string,
    created_at: createdAt,
    updated_at: now,
    version: 1,
  }
  asset.storage_key = normalizeStorageKey(input.storage_key, asset)
  assertStateConsistency(asset)
  return asset
}

const IMMUTABLE_UPDATE_FIELDS = [
  'asset_id', 'project_id', 'mission_id', 'source_id', 'filename', 'media_type', 'asset_kind', 'size_bytes', 'sha256',
  'origin', 'idempotency_key', 'created_by', 'created_at',
] as const

export function normalizeAssetUpdate(
  current: AssetMetadata,
  value: unknown,
  now = new Date().toISOString(),
  policy?: Partial<AssetPolicy>,
): AssetMetadata {
  const input = record(value)
  if (!input) throw new Error('Asset metadata update body is required')
  const expectedVersion = Number(input.expected_version)
  if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
    throw new Error(`Asset version mismatch: expected ${expectedVersion}, current ${current.version}`)
  }
  for (const field of IMMUTABLE_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) throw new Error(`${field} is immutable`)
  }

  const uploadStatus = input.upload_status === undefined
    ? current.upload_status
    : enumValue(input.upload_status, UPLOAD_STATUSES, current.upload_status, 'upload_status')
  const processingStatus = input.processing_status === undefined
    ? current.processing_status
    : enumValue(input.processing_status, PROCESSING_STATUSES, current.processing_status, 'processing_status')
  if (!UPLOAD_TRANSITIONS[current.upload_status].has(uploadStatus)) {
    throw new Error(`Invalid upload status transition: ${current.upload_status} -> ${uploadStatus}`)
  }
  if (!PROCESSING_TRANSITIONS[current.processing_status].has(processingStatus)) {
    throw new Error(`Invalid processing status transition: ${current.processing_status} -> ${processingStatus}`)
  }

  const updated: AssetMetadata = {
    ...current,
    display_name: input.display_name === undefined ? current.display_name : sanitizeAssetFilename(input.display_name),
    storage_provider: input.storage_provider === undefined ? current.storage_provider : normalizeProvider(input.storage_provider),
    upload_status: uploadStatus,
    processing_status: processingStatus,
    sensitivity: input.sensitivity === undefined
      ? current.sensitivity
      : enumValue(input.sensitivity, SENSITIVITIES, current.sensitivity, 'sensitivity'),
    updated_at: now,
    version: current.version + 1,
  }
  updated.storage_key = input.storage_key === undefined ? current.storage_key : normalizeStorageKey(input.storage_key, updated)
  normalizeSize(updated.size_bytes, policy)
  assertStateConsistency(updated)

  const unchanged = updated.display_name === current.display_name &&
    updated.storage_provider === current.storage_provider &&
    updated.storage_key === current.storage_key &&
    updated.upload_status === current.upload_status &&
    updated.processing_status === current.processing_status &&
    updated.sensitivity === current.sensitivity
  return unchanged ? current : updated
}

export function assetCreateFingerprint(asset: AssetMetadata): string {
  return JSON.stringify({
    asset_id: asset.asset_id,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    source_id: asset.source_id,
    filename: asset.filename,
    media_type: asset.media_type,
    asset_kind: asset.asset_kind,
    size_bytes: asset.size_bytes,
    sha256: asset.sha256,
    origin: asset.origin,
    sensitivity: asset.sensitivity,
    idempotency_key: asset.idempotency_key,
    created_by: asset.created_by,
  })
}

export function assetToBrainObject(asset: AssetMetadata): BrainObject {
  return {
    schema: 'brain-v2',
    object_id: asset.asset_id,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    kind: 'asset',
    title: asset.display_name,
    body: null,
    attributes: {
      asset_schema: asset.schema,
      source_id: asset.source_id,
      filename: asset.filename,
      display_name: asset.display_name,
      media_type: asset.media_type,
      asset_kind: asset.asset_kind,
      size_bytes: asset.size_bytes,
      sha256: asset.sha256,
      storage_provider: asset.storage_provider,
      storage_key: asset.storage_key,
      upload_status: asset.upload_status,
      processing_status: asset.processing_status,
      origin: asset.origin,
      idempotency_key: asset.idempotency_key,
    },
    source_ids: asset.source_id ? [asset.source_id] : [],
    truth_status: ['owner_upload', 'imported', 'repository_export'].includes(asset.origin) ? 'raw' : 'proposed',
    sensitivity: asset.sensitivity,
    retention: 'project',
    expires_at: null,
    created_by: asset.created_by,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
    version: asset.version,
  }
}

export function assetFromBrainObject(object: BrainObject): AssetMetadata {
  if (object.kind !== 'asset') throw new Error('Brain object is not an asset')
  const attributes = record(object.attributes)
  if (!attributes || attributes.asset_schema !== ASSET_SCHEMA_VERSION) throw new Error('Asset object schema is invalid')
  const asset = normalizeAssetCreate({
    asset_id: object.object_id,
    project_id: object.project_id,
    mission_id: object.mission_id,
    source_id: attributes.source_id,
    filename: attributes.filename,
    display_name: attributes.display_name,
    media_type: attributes.media_type,
    asset_kind: attributes.asset_kind,
    size_bytes: attributes.size_bytes,
    sha256: attributes.sha256,
    storage_provider: attributes.storage_provider,
    storage_key: attributes.storage_key,
    upload_status: attributes.upload_status,
    processing_status: attributes.processing_status,
    origin: attributes.origin,
    sensitivity: object.sensitivity,
    idempotency_key: attributes.idempotency_key,
    created_by: object.created_by,
    created_at: object.created_at,
  }, object.updated_at, { max_size_bytes: Number.MAX_SAFE_INTEGER })
  return { ...asset, updated_at: object.updated_at, version: object.version }
}
