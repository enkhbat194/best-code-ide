import {
  ASSET_STORAGE_ACCESS,
  assetObjectKey,
  buildPrivateAssetHeaders,
  normalizeAssetIntegrity,
  normalizeAssetWriteMetadata,
  sha256Hex,
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

interface MemoryRecord {
  bytes: Uint8Array
  object: AssetStoredObject
}
interface MemoryMultipartSession {
  key: string
  ref: AssetObjectRef
  options: AssetMultipartOptions
  parts: Map<number, { bytes: Uint8Array; part: AssetUploadedPart }>
}

export class MemoryAssetStore implements AssetStore {
  readonly provider = 'memory'
  readonly access = ASSET_STORAGE_ACCESS
  private readonly objects = new Map<string, MemoryRecord>()
  private readonly multipart = new Map<string, MemoryMultipartSession>()

  async put(ref: AssetObjectRef, options: AssetWriteOptions): Promise<AssetStoredObject> {
    const key = assetObjectKey(ref)
    const integrity = normalizeAssetIntegrity(options)
    if (integrity.sha256 !== ref.sha256.toLowerCase()) throw new Error('Asset reference SHA-256 does not match write integrity')
    const metadata = normalizeAssetWriteMetadata(options)
    const bytes = await verifyAssetBody(options.body, integrity)
    const object: AssetStoredObject = {
      provider: this.provider,
      access: this.access,
      key,
      sha256: integrity.sha256,
      sizeBytes: integrity.sizeBytes,
      mediaType: metadata.mediaType,
      filename: metadata.filename,
      etag: `"${integrity.sha256}"`,
      uploadedAt: new Date().toISOString(),
      verification: 'local-sha256-and-size',
    }
    this.objects.set(key, { bytes, object })
    return structuredClone(object)
  }

  async get(ref: AssetObjectRef): Promise<AssetObjectBody | null> {
    const record = this.objects.get(assetObjectKey(ref))
    if (!record) return null
    const bytes = record.bytes.slice()
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
    return { ...structuredClone(record.object), body, headers: buildPrivateAssetHeaders(record.object) }
  }

  async head(ref: AssetObjectRef): Promise<AssetStoredObject | null> {
    const record = this.objects.get(assetObjectKey(ref))
    return record ? structuredClone(record.object) : null
  }

  async delete(ref: AssetObjectRef): Promise<void> {
    this.objects.delete(assetObjectKey(ref))
  }

  async createMultipartUpload(ref: AssetObjectRef, options: AssetMultipartOptions): Promise<AssetMultipartUpload> {
    const key = assetObjectKey(ref)
    const integrity = normalizeAssetIntegrity(options)
    if (integrity.sha256 !== ref.sha256.toLowerCase()) throw new Error('Asset reference SHA-256 does not match multipart integrity')
    const normalized: AssetMultipartOptions = { ...integrity, ...normalizeAssetWriteMetadata(options) }
    const uploadId = crypto.randomUUID()
    this.multipart.set(uploadId, { key, ref: structuredClone(ref), options: normalized, parts: new Map() })
    return this.multipartHandle(uploadId)
  }

  resumeMultipartUpload(ref: AssetObjectRef, uploadId: string, options: AssetMultipartOptions): AssetMultipartUpload {
    const session = this.multipart.get(uploadId)
    if (!session || session.key !== assetObjectKey(ref)) throw new Error('Multipart upload session was not found')
    const integrity = normalizeAssetIntegrity(options)
    const metadata = normalizeAssetWriteMetadata(options)
    if (integrity.sha256 !== session.options.sha256 || integrity.sizeBytes !== session.options.sizeBytes || metadata.mediaType !== session.options.mediaType || metadata.filename !== session.options.filename) {
      throw new Error('Multipart resume metadata does not match the original upload')
    }
    return this.multipartHandle(uploadId)
  }

  private multipartHandle(uploadId: string): AssetMultipartUpload {
    const session = this.multipart.get(uploadId)
    if (!session) throw new Error('Multipart upload session was not found')
    return {
      key: session.key,
      uploadId,
      uploadPart: async (partNumber: number, body: AssetBinary, integrity: AssetIntegrity) => {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) throw new Error('Multipart part number is invalid')
        const normalized = normalizeAssetIntegrity(integrity)
        const bytes = await verifyAssetBody(body, normalized)
        const part: AssetUploadedPart = { partNumber, etag: `"${await sha256Hex(bytes)}"`, ...normalized }
        session.parts.set(partNumber, { bytes, part })
        return structuredClone(part)
      },
      complete: async (parts: AssetUploadedPart[]) => {
        const sorted = validateMultipartParts(parts, session.options)
        const buffers: Uint8Array[] = []
        for (const supplied of sorted) {
          const actual = session.parts.get(supplied.partNumber)
          if (!actual || actual.part.etag !== supplied.etag || actual.part.sha256 !== supplied.sha256 || actual.part.sizeBytes !== supplied.sizeBytes) throw new Error('Multipart completion contains an unknown or changed part')
          buffers.push(actual.bytes)
        }
        const bytes = new Uint8Array(session.options.sizeBytes)
        let offset = 0
        for (const buffer of buffers) { bytes.set(buffer, offset); offset += buffer.byteLength }
        const object = await this.put(session.ref, { ...session.options, body: bytes })
        this.multipart.delete(uploadId)
        return object
      },
      abort: async () => { this.multipart.delete(uploadId) },
    }
  }
}
