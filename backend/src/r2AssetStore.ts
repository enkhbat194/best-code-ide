import type { Env } from './types'
import {
  ASSET_STORAGE_ACCESS,
  arrayBufferToHex,
  assetCustomMetadata,
  assetObjectKey,
  buildPrivateAssetHeaders,
  hexToArrayBuffer,
  metadataFilename,
  metadataMediaType,
  normalizeAssetIntegrity,
  normalizeAssetWriteMetadata,
  privateAssetHttpMetadata,
  validateMultipartParts,
  verifyAssetBody,
  type AssetBinary,
  type AssetIntegrity,
  type AssetMultipartOptions,
  type AssetMultipartUpload,
  type AssetObjectBody,
  type AssetObjectRef,
  type AssetStore,
  type AssetStoredObject,
  type AssetUploadedPart,
  type AssetWriteOptions,
} from './assetStorage'

export const R2_ASSET_PROVIDER = 'r2' as const

function assertCustomMetadata(ref: AssetObjectRef, key: string, customMetadata: Record<string, string> | undefined, expected: AssetIntegrity): void {
  const integrity = normalizeAssetIntegrity(expected)
  if (!customMetadata || customMetadata.asset_schema !== 'asset-storage-v1' || customMetadata.access !== ASSET_STORAGE_ACCESS) throw new Error('Stored R2 object is missing the private asset metadata contract')
  if (customMetadata.key !== key || customMetadata.project_id !== ref.projectId || customMetadata.asset_id !== ref.assetId) throw new Error('Stored R2 object identity metadata does not match the requested asset')
  if (customMetadata.sha256 !== integrity.sha256 || Number(customMetadata.size_bytes) !== integrity.sizeBytes) throw new Error('Stored R2 object integrity metadata does not match the requested asset')
}

function descriptor(ref: AssetObjectRef, object: R2Object, verification: AssetStoredObject['verification']): AssetStoredObject {
  const key = assetObjectKey(ref)
  if (object.key !== key) throw new Error('R2 returned a non-canonical asset key')
  const customMetadata = object.customMetadata
  const expected = { sha256: ref.sha256, sizeBytes: object.size }
  assertCustomMetadata(ref, key, customMetadata, expected)
  if (!customMetadata) throw new Error('Stored R2 object metadata is unavailable')
  const declaredSize = Number(customMetadata.size_bytes)
  if (object.size !== declaredSize) throw new Error(`Stored R2 object size mismatch: metadata ${declaredSize}, object ${object.size}`)
  return {
    provider: R2_ASSET_PROVIDER,
    access: ASSET_STORAGE_ACCESS,
    key,
    sha256: customMetadata.sha256,
    sizeBytes: object.size,
    mediaType: metadataMediaType(customMetadata),
    filename: metadataFilename(customMetadata),
    etag: object.httpEtag,
    uploadedAt: object.uploaded.toISOString(),
    verification,
  }
}

export class R2AssetStore implements AssetStore {
  readonly provider = R2_ASSET_PROVIDER
  readonly access = ASSET_STORAGE_ACCESS
  private readonly bucket: R2Bucket

  constructor(bucket: R2Bucket) { this.bucket = bucket }

  async put(ref: AssetObjectRef, options: AssetWriteOptions): Promise<AssetStoredObject> {
    const key = assetObjectKey(ref)
    const integrity = normalizeAssetIntegrity(options)
    if (integrity.sha256 !== ref.sha256.toLowerCase()) throw new Error('Asset reference SHA-256 does not match write integrity')
    const metadata = normalizeAssetWriteMetadata(options)
    const bytes = await verifyAssetBody(options.body, integrity)
    const object = await this.bucket.put(key, bytes, {
      httpMetadata: privateAssetHttpMetadata(metadata.mediaType, metadata.filename),
      customMetadata: assetCustomMetadata(ref, { ...integrity, ...metadata }),
      sha256: hexToArrayBuffer(integrity.sha256),
    })
    if (!object) throw new Error('R2 put failed closed without storing the asset')
    if (object.size !== integrity.sizeBytes) throw new Error(`R2 put size mismatch: expected ${integrity.sizeBytes}, stored ${object.size}`)
    if (object.checksums.sha256 && arrayBufferToHex(object.checksums.sha256) !== integrity.sha256) throw new Error('R2 put checksum verification failed')
    return descriptor(ref, object, 'provider-sha256-and-size')
  }

  async get(ref: AssetObjectRef): Promise<AssetObjectBody | null> {
    const object = await this.bucket.get(assetObjectKey(ref))
    if (!object) return null
    if (!('body' in object) || !object.body) throw new Error('R2 get returned metadata without a body')
    const stored = descriptor(ref, object, object.checksums.sha256 ? 'provider-sha256-and-size' : 'caller-sha256-and-provider-size')
    return { ...stored, body: object.body, headers: buildPrivateAssetHeaders(stored) }
  }

  async head(ref: AssetObjectRef): Promise<AssetStoredObject | null> {
    const object = await this.bucket.head(assetObjectKey(ref))
    return object ? descriptor(ref, object, object.checksums.sha256 ? 'provider-sha256-and-size' : 'caller-sha256-and-provider-size') : null
  }

  async delete(ref: AssetObjectRef): Promise<void> {
    await this.bucket.delete(assetObjectKey(ref))
  }

  async createMultipartUpload(ref: AssetObjectRef, options: AssetMultipartOptions): Promise<AssetMultipartUpload> {
    const key = assetObjectKey(ref)
    const integrity = normalizeAssetIntegrity(options)
    if (integrity.sha256 !== ref.sha256.toLowerCase()) throw new Error('Asset reference SHA-256 does not match multipart integrity')
    const metadata = normalizeAssetWriteMetadata(options)
    const upload = await this.bucket.createMultipartUpload(key, {
      httpMetadata: privateAssetHttpMetadata(metadata.mediaType, metadata.filename),
      customMetadata: assetCustomMetadata(ref, { ...integrity, ...metadata }),
    })
    return this.multipartHandle(ref, upload, { ...integrity, ...metadata })
  }

  resumeMultipartUpload(ref: AssetObjectRef, uploadId: string, options: AssetMultipartOptions): AssetMultipartUpload {
    const integrity = normalizeAssetIntegrity(options)
    if (integrity.sha256 !== ref.sha256.toLowerCase()) throw new Error('Asset reference SHA-256 does not match multipart integrity')
    const metadata = normalizeAssetWriteMetadata(options)
    const upload = this.bucket.resumeMultipartUpload(assetObjectKey(ref), uploadId)
    return this.multipartHandle(ref, upload, { ...integrity, ...metadata })
  }

  private multipartHandle(ref: AssetObjectRef, upload: R2MultipartUpload, options: AssetMultipartOptions): AssetMultipartUpload {
    const key = assetObjectKey(ref)
    if (upload.key !== key) throw new Error('R2 multipart upload key is not canonical')
    return {
      key,
      uploadId: upload.uploadId,
      uploadPart: async (partNumber: number, body: AssetBinary, integrity: AssetIntegrity): Promise<AssetUploadedPart> => {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) throw new Error('Multipart part number is invalid')
        const normalized = normalizeAssetIntegrity(integrity)
        const bytes = await verifyAssetBody(body, normalized)
        const uploaded = await upload.uploadPart(partNumber, bytes)
        return { partNumber: uploaded.partNumber, etag: uploaded.etag, ...normalized }
      },
      complete: async (parts: AssetUploadedPart[]): Promise<AssetStoredObject> => {
        const sorted = validateMultipartParts(parts, options)
        const object = await upload.complete(sorted.map(({ partNumber, etag }) => ({ partNumber, etag })))
        if (object.size !== options.sizeBytes) throw new Error(`R2 multipart size mismatch: expected ${options.sizeBytes}, stored ${object.size}`)
        return descriptor(ref, object, 'caller-sha256-and-provider-size')
      },
      abort: () => upload.abort(),
    }
  }
}

export function requireR2AssetStore(env: Pick<Env, 'ASSET_BUCKET'>): R2AssetStore {
  if (!env.ASSET_BUCKET) throw new Error('R2 asset storage is not configured; refusing binary storage')
  return new R2AssetStore(env.ASSET_BUCKET)
}
