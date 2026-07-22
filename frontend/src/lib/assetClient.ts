import { useSettingsStore } from '../store/settingsStore'
import type { AssetReference } from '../types'

export type AttachmentStatus =
  | 'selected'
  | 'hashing'
  | 'registering'
  | 'uploading'
  | 'stored'
  | 'linked'
  | 'failed'

export interface PreparedAttachment {
  filename: string
  mediaType: string
  sizeBytes: number
}

export interface AssetMetadata {
  asset_id: string
  project_id: string
  mission_id: string | null
  filename: string
  display_name: string
  media_type: string
  size_bytes: number
  sha256: string
  upload_status: 'pending' | 'uploading' | 'stored' | 'failed' | 'deleted'
  processing_status: string
  storage_provider: string
  storage_key: string | null
  version: number
}

export interface AssetRegistrationResult {
  asset: AssetMetadata
  created: boolean
  duplicate: boolean
  idempotent: boolean
  binary_created?: boolean
  reused_asset_id?: string
}

interface ProjectListItem {
  id: string
  repository: string
}

interface ActionEnvelope<T> {
  ok: boolean
  result?: T
  error?: { code?: string; message?: string; action_required?: string }
}

interface AssetRelation {
  relation_id: string
  relation_type: string
  from_object_id: string
  to_object_id: string
}

export interface AssetReferenceSummary {
  asset_id: string
  project_id: string
  active_reference_count: number
  total_relationship_count: number
  by_type: Record<string, number>
  relationships: AssetRelation[]
}

const SERVER_MAX_ASSET_BYTES = 104_857_600
const DEFAULT_ATTACHMENT_COUNT = 5
const MAX_ATTACHMENT_COUNT_CEILING = 10
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/
const PATH_ESCAPE = /[\\/\u0000-\u001f\u007f]|%(?:2e|2f|5c)/i
const UNSAFE_FILENAME_CHARS = /[<>:"|?*&'`=]/g
const DANGEROUS_BINARY_MIME = new Set([
  'application/x-dosexec',
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-msdos-program',
  'application/x-msdownload',
  'application/x-sharedlib',
  'application/vnd.microsoft.portable-executable',
])

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  csv: 'text/csv',
  css: 'text/css',
  html: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  xml: 'application/xml',
  json: 'application/json',
  js: 'application/javascript',
  jsx: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  gz: 'application/gzip',
  rar: 'application/x-rar-compressed',
  tar: 'application/x-tar',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
}

function numberSetting(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

export const MAX_CHAT_ATTACHMENTS = numberSetting(
  import.meta.env.VITE_MAX_CHAT_ATTACHMENTS,
  DEFAULT_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_COUNT_CEILING,
)

export const MAX_CHAT_ATTACHMENT_BYTES = numberSetting(
  import.meta.env.VITE_MAX_CHAT_ATTACHMENT_BYTES,
  SERVER_MAX_ASSET_BYTES,
  SERVER_MAX_ASSET_BYTES,
)

function settings() {
  const current = useSettingsStore.getState()
  if (!current.isConfigured()) throw new Error('Backend URL, token болон repository тохиргоо дутуу байна.')
  return current
}

function sanitizeFilename(value: string): string {
  const input = value.trim().slice(0, 500)
  if (!input || PATH_ESCAPE.test(input) || input === '.' || input === '..') {
    throw new Error('Файлын нэр буруу эсвэл замын тэмдэгт агуулсан байна.')
  }
  const normalized = input
    .normalize('NFKC')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180)
  if (!normalized) throw new Error('Файлын нэрийг аюулгүй хэлбэрт оруулах боломжгүй байна.')
  return normalized
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index > -1 ? filename.slice(index + 1).toLowerCase() : ''
}

function normalizeMediaType(file: File): string {
  const declared = file.type.split(';', 1)[0]?.trim().toLowerCase()
  const mediaType = declared || EXTENSION_MEDIA_TYPES[extensionOf(file.name)] || 'application/octet-stream'
  if (!MIME_PATTERN.test(mediaType)) throw new Error('Файлын MIME төрөл буруу байна.')
  if (DANGEROUS_BINARY_MIME.has(mediaType)) throw new Error('Энэ төрлийн executable файл хадгалахыг серверийн бодлого хориглосон.')
  return mediaType
}

export function preflightAttachment(file: File): PreparedAttachment {
  if (!(file instanceof File)) throw new Error('Сонгосон өгөгдөл файл биш байна.')
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Файлын хэмжээ буруу байна.')
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error(`Файл хэт том байна. Дээд хэмжээ ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1_048_576)} МБ.`)
  }
  return {
    filename: sanitizeFilename(file.name || 'attachment'),
    mediaType: normalizeMediaType(file),
    sizeBytes: file.size,
  }
}

export async function sha256File(file: File): Promise<string> {
  if (!crypto.subtle) throw new Error('Энэ browser Web Crypto SHA-256 дэмжихгүй байна.')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function mongolianHttpError(status: number, message: string): string {
  if (status === 401) return 'Нэвтрэх token буруу эсвэл хугацаа дууссан байна.'
  if (status === 403) return 'Энэ хүсэлтийг хийх эрх эсвэл origin зөвшөөрөл алга.'
  if (status === 404) return 'Asset эсвэл файл сервер дээр олдсонгүй.'
  if (status === 409) return `Asset төлөв зөрчилтэй байна. ${message}`
  if (status === 411) return 'Browser файлын хэмжээг серверт дамжуулж чадсангүй.'
  if (status === 413) return 'Файл серверийн зөвшөөрсөн хэмжээнээс том байна.'
  if (status === 415) return 'Энэ MIME төрлийн файлыг сервер хүлээн авахгүй байна.'
  if (status === 422) return 'Файлын хэмжээ эсвэл SHA-256 серверийн metadata-тай таарахгүй байна.'
  if (status === 429) return 'Хэт олон хүсэлт илгээсэн байна. Түр завсарлаад дахин оролдоно уу.'
  if (status === 503) return 'Private R2 хадгалалт одоогоор бэлэн биш байна.'
  return message || `Server хүсэлт амжилтгүй (${status}).`
}

async function responseMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as {
    error?: string | { message?: string; action_required?: string }
  } | null
  if (typeof payload?.error === 'string') return payload.error
  if (payload?.error && typeof payload.error === 'object') {
    return [payload.error.message, payload.error.action_required].filter(Boolean).join(' ')
  }
  return response.statusText
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const current = settings()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${current.authToken}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${current.backendUrl}${path}`, { ...init, headers })
  if (!response.ok) {
    const message = await responseMessage(response)
    throw new Error(mongolianHttpError(response.status, message))
  }
  return response.json() as Promise<T>
}

let cachedProject: { repository: string; projectId: string } | null = null

export async function resolveConfiguredProjectId(): Promise<string> {
  const current = settings()
  const repository = `${current.owner}/${current.repo}`.toLowerCase()
  if (cachedProject?.repository === repository) return cachedProject.projectId
  const payload = await requestJson<ActionEnvelope<{ items: ProjectListItem[] }>>('/api/actions/projects_list', {
    method: 'POST',
    body: JSON.stringify({ limit: 50 }),
  })
  const project = payload.ok && payload.result
    ? payload.result.items.find((item) => item.repository.toLowerCase() === repository)
    : null
  if (!project) throw new Error('Project registry-д одоогийн repository олдсонгүй.')
  cachedProject = { repository, projectId: project.id }
  return project.id
}

export function createAttachmentAssetId(): string {
  return crypto.randomUUID()
}

export async function registerAttachmentAsset(input: {
  assetId: string
  projectId: string
  prepared: PreparedAttachment
  sha256: string
}): Promise<AssetRegistrationResult> {
  return requestJson<AssetRegistrationResult>('/api/brain/assets', {
    method: 'POST',
    body: JSON.stringify({
      asset_id: input.assetId,
      project_id: input.projectId,
      mission_id: null,
      source_id: null,
      filename: input.prepared.filename,
      display_name: input.prepared.filename,
      media_type: input.prepared.mediaType,
      size_bytes: input.prepared.sizeBytes,
      sha256: input.sha256,
      upload_status: 'pending',
      processing_status: 'not_requested',
      origin: 'owner_upload',
      sensitivity: 'private',
      idempotency_key: input.assetId,
      created_by: 'bestcode-pwa-chat',
    }),
  })
}

export function uploadAttachmentBinary(
  asset: AssetMetadata,
  file: File,
  onProgress: (percent: number) => void,
): Promise<AssetMetadata> {
  const current = settings()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${current.backendUrl}/api/brain/assets/${encodeURIComponent(asset.asset_id)}/content`)
    xhr.setRequestHeader('Authorization', `Bearer ${current.authToken}`)
    xhr.setRequestHeader('Content-Type', asset.media_type)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onerror = () => reject(new Error('Файл upload хийх үеийн сүлжээний алдаа.'))
    xhr.onabort = () => reject(new Error('Файл upload цуцлагдлаа.'))
    xhr.onload = () => {
      const payload = (xhr.response || (() => {
        try { return JSON.parse(xhr.responseText) } catch { return null }
      })()) as { asset?: AssetMetadata; error?: string } | null
      if (xhr.status < 200 || xhr.status >= 300 || !payload?.asset) {
        reject(new Error(mongolianHttpError(xhr.status, payload?.error || xhr.statusText)))
        return
      }
      onProgress(100)
      resolve(payload.asset)
    }
    xhr.send(file)
  })
}

export async function linkAttachmentToMission(assetId: string, missionId: string): Promise<string> {
  const result = await requestJson<{ relation: AssetRelation }>(
    `/api/brain/assets/${encodeURIComponent(assetId)}/links`,
    {
      method: 'POST',
      body: JSON.stringify({
        relation_type: 'used_by_mission',
        target_object_id: missionId,
        created_by: 'bestcode-pwa-chat',
        provenance: {
          actor_type: 'owner',
          actor_id: 'bestcode-pwa-chat',
          tool: 'ai-chat-attachment-ui',
        },
      }),
    },
  )
  return result.relation.relation_id
}

export async function unlinkAttachmentRelation(assetId: string, relationId: string): Promise<void> {
  await requestJson(`/api/brain/assets/${encodeURIComponent(assetId)}/links/${encodeURIComponent(relationId)}?actor_id=bestcode-pwa-chat`, {
    method: 'DELETE',
  })
}

export async function readAttachmentReferences(assetId: string): Promise<AssetReferenceSummary> {
  return requestJson<AssetReferenceSummary>(`/api/brain/assets/${encodeURIComponent(assetId)}/references`)
}

export async function deleteAttachmentAsset(assetId: string): Promise<void> {
  await requestJson(`/api/brain/assets/${encodeURIComponent(assetId)}/content`, { method: 'DELETE' })
}

export async function cleanupUnsentAttachment(input: {
  assetId: string
  relationId?: string
  ownsMetadata: boolean
}): Promise<{ deleted: boolean; retainedReferences: number }> {
  if (input.relationId) await unlinkAttachmentRelation(input.assetId, input.relationId)
  const references = await readAttachmentReferences(input.assetId)
  if (!input.ownsMetadata || references.active_reference_count > 0) {
    return { deleted: false, retainedReferences: references.active_reference_count }
  }
  await deleteAttachmentAsset(input.assetId)
  return { deleted: true, retainedReferences: 0 }
}

export function extractExplicitMissionId(text: string): string | null {
  const labelled = text.match(/\bmission(?:\s*id)?\s*[:#-]?\s*([A-Za-z0-9._:-]{3,64})/i)
  if (labelled?.[1]) return labelled[1]
  const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)
  return uuid?.[0] ?? null
}

export function assetReferenceFromMetadata(
  asset: AssetMetadata,
  missionId: string | null,
  relationId?: string,
): AssetReference {
  if (asset.upload_status !== 'stored') throw new Error('Бүрэн хадгалагдаагүй Asset-ийг chat message-д хавсаргахгүй.')
  return {
    asset_id: asset.asset_id,
    project_id: asset.project_id,
    mission_id: missionId,
    filename: asset.filename,
    media_type: asset.media_type,
    size_bytes: asset.size_bytes,
    sha256: asset.sha256,
    upload_status: 'stored',
    ...(relationId ? { relation_id: relationId } : {}),
  }
}
