import {
  buildAssetStorageKey,
  normalizeAssetMediaType,
  normalizeAssetSha256,
  sanitizeAssetFilename,
} from './assetSchema'

export const ASSET_STORAGE_ACCESS = 'private' as const
export const ASSET_MULTIPART_MIN_PART_BYTES = 5_242_880
export const ASSET_MULTIPART_MAX_PARTS = 10_000

export type AssetBinary = ArrayBuffer | ArrayBufferView | Blob
export type AssetIntegrityVerification = 'provider-sha256-and-size' | 'caller-sha256-and-provider-size' | 'local-sha256-and-size'

export interface AssetObjectRef {
  projectId: string
  assetId: string
  sha256: string
}

export interface AssetIntegrity {
  sha256: string
  sizeBytes: number
}

export interface AssetWriteOptions extends AssetIntegrity {
  body: AssetBinary
  mediaType: string
  filename: string
}

export interface AssetMultipartOptions extends AssetIntegrity {
  mediaType: string
  filename: string
}

export interface AssetHttpMetadata {
  contentType: string
  contentDisposition: string
  cacheControl: string
}

export interface AssetStoredObject extends AssetIntegrity {
  provider: string
  access: typeof ASSET_STORAGE_ACCESS
  key: string
  mediaType: string
  filename: string
  etag: string
  uploadedAt: string
  verification: AssetIntegrityVerification
}

export interface AssetObjectBody extends AssetStoredObject {
  body: ReadableStream
  headers: Headers
}

export interface AssetUploadedPart extends AssetIntegrity {
  partNumber: number
  etag: string
}

export interface AssetMultipartUpload {
  readonly key: string
  readonly uploadId: string
  uploadPart(partNumber: number, body: AssetBinary, integrity: AssetIntegrity): Promise<AssetUploadedPart>
  complete(parts: AssetUploadedPart[]): Promise<AssetStoredObject>
  abort(): Promise<void>
}

export interface AssetStore {
  readonly provider: string
  readonly access: typeof ASSET_STORAGE_ACCESS
  put(ref: AssetObjectRef, options: AssetWriteOptions): Promise<AssetStoredObject>
  get(ref: AssetObjectRef): Promise<AssetObjectBody | null>
  head(ref: AssetObjectRef): Promise<AssetStoredObject | null>
  delete(ref: AssetObjectRef): Promise<void>
  createMultipartUpload(ref: AssetObjectRef, options: AssetMultipartOptions): Promise<AssetMultipartUpload>
  resumeMultipartUpload(ref: AssetObjectRef, uploadId: string, options: AssetMultipartOptions): AssetMultipartUpload
}

export function assetObjectKey(ref: AssetObjectRef): string {
  return buildAssetStorageKey(ref.projectId, ref.assetId, ref.sha256)
}

export function normalizeAssetIntegrity(value: AssetIntegrity): AssetIntegrity {
  const sha256 = normalizeAssetSha256(value.sha256)
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) {
    throw new Error('sizeBytes must be a non-negative safe integer')
  }
  return { sha256, sizeBytes: value.sizeBytes }
}

export function normalizeAssetWriteMetadata(value: Pick<AssetMultipartOptions, 'mediaType' | 'filename'>): Pick<AssetMultipartOptions, 'mediaType' | 'filename'> {
  return {
    mediaType: normalizeAssetMediaType(value.mediaType),
    filename: sanitizeAssetFilename(value.filename),
  }
}

export function buildAssetContentDisposition(filename: string): string {
  const safe = sanitizeAssetFilename(filename)
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_') || 'download'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

export function privateAssetHttpMetadata(mediaType: string, filename: string): AssetHttpMetadata {
  const metadata = normalizeAssetWriteMetadata({ mediaType, filename })
  return {
    contentType: metadata.mediaType,
    contentDisposition: buildAssetContentDisposition(metadata.filename),
    cacheControl: 'private, no-store',
  }
}

export function assetCustomMetadata(ref: AssetObjectRef, options: AssetMultipartOptions): Record<string, string> {
  const integrity = normalizeAssetIntegrity(options)
  const metadata = normalizeAssetWriteMetadata(options)
  const key = assetObjectKey(ref)
  return {
    asset_schema: 'asset-storage-v1',
    access: ASSET_STORAGE_ACCESS,
    key,
    project_id: ref.projectId,
    asset_id: ref.assetId,
    sha256: integrity.sha256,
    size_bytes: String(integrity.sizeBytes),
    media_type: metadata.mediaType,
    filename: encodeURIComponent(metadata.filename),
  }
}

export function metadataFilename(metadata: Record<string, string> | undefined): string {
  const raw = metadata?.filename
  if (!raw) throw new Error('Stored asset filename metadata is missing')
  try {
    return sanitizeAssetFilename(decodeURIComponent(raw))
  } catch {
    throw new Error('Stored asset filename metadata is invalid')
  }
}

export function metadataMediaType(metadata: Record<string, string> | undefined): string {
  if (!metadata?.media_type) throw new Error('Stored asset media type metadata is missing')
  return normalizeAssetMediaType(metadata.media_type)
}

export function bytesFromAssetBinary(body: AssetBinary): Promise<Uint8Array> {
  if (body instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(body.slice(0)))
  if (ArrayBuffer.isView(body)) return Promise.resolve(Uint8Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)))
  if (body instanceof Blob) return body.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  throw new Error('Unsupported asset body')
}

export function hexToArrayBuffer(value: string): ArrayBuffer {
  const hex = normalizeAssetSha256(value)
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes.buffer
}

export function arrayBufferToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(body: AssetBinary): Promise<string> {
  const bytes = await bytesFromAssetBinary(body)
  return arrayBufferToHex(await crypto.subtle.digest('SHA-256', bytes))
}

export async function verifyAssetBody(body: AssetBinary, expected: AssetIntegrity): Promise<Uint8Array> {
  const integrity = normalizeAssetIntegrity(expected)
  const bytes = await bytesFromAssetBinary(body)
  if (bytes.byteLength !== integrity.sizeBytes) {
    throw new Error(`Asset size mismatch: expected ${integrity.sizeBytes}, received ${bytes.byteLength}`)
  }
  const actualSha256 = arrayBufferToHex(await crypto.subtle.digest('SHA-256', bytes))
  if (actualSha256 !== integrity.sha256) {
    throw new Error(`Asset SHA-256 mismatch: expected ${integrity.sha256}, received ${actualSha256}`)
  }
  return bytes
}

export function validateMultipartParts(parts: AssetUploadedPart[], expected: AssetIntegrity): AssetUploadedPart[] {
  const integrity = normalizeAssetIntegrity(expected)
  if (parts.length < 1 || parts.length > ASSET_MULTIPART_MAX_PARTS) throw new Error('Multipart upload must contain between 1 and 10000 parts')
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  const seen = new Set<number>()
  for (let index = 0; index < sorted.length; index += 1) {
    const part = sorted[index]
    normalizeAssetIntegrity(part)
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > ASSET_MULTIPART_MAX_PARTS) throw new Error('Multipart part number is invalid')
    if (seen.has(part.partNumber)) throw new Error('Multipart part numbers must be unique')
    seen.add(part.partNumber)
    if (index < sorted.length - 1 && part.sizeBytes < ASSET_MULTIPART_MIN_PART_BYTES) throw new Error('Every non-final multipart part must be at least 5 MiB')
    if (index > 0 && index < sorted.length - 1 && part.sizeBytes !== sorted[0].sizeBytes) throw new Error('Multipart non-final parts must have a uniform size')
  }
  const total = sorted.reduce((sum, part) => sum + part.sizeBytes, 0)
  if (!Number.isSafeInteger(total) || total !== integrity.sizeBytes) throw new Error(`Multipart size mismatch: expected ${integrity.sizeBytes}, received ${total}`)
  return sorted
}

export function buildPrivateAssetHeaders(object: AssetStoredObject): Headers {
  const headers = new Headers({
    'Content-Type': normalizeAssetMediaType(object.mediaType),
    'Content-Disposition': buildAssetContentDisposition(object.filename),
    'Content-Length': String(object.sizeBytes),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (object.etag) headers.set('ETag', object.etag)
  return headers
}
