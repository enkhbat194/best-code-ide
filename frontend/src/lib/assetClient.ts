import { useSettingsStore } from '../store/settingsStore'
import type { ChatAttachmentReference } from '../types'
import { normalizeAttachmentMediaType } from './chatAttachmentPolicy'

interface ActionEnvelope<T> {
  ok: boolean
  result?: T
  error?: { message?: string; action_required?: string }
}

interface ProjectListItem {
  id: string
  repository: string
}

export interface AssetMetadata {
  asset_id: string
  project_id: string
  mission_id: string | null
  filename: string
  media_type: string
  size_bytes: number
  sha256: string
  upload_status: 'pending' | 'uploading' | 'stored' | 'failed' | 'deleted'
  processing_status: ChatAttachmentReference['processing_status']
  version: number
}

export interface AssetRegistrationResult {
  asset: AssetMetadata
  created: boolean
  duplicate: boolean
  idempotent: boolean
  binary_created?: boolean
}

export interface AssetReferenceSummary {
  asset_id: string
  project_id: string
  active_reference_count: number
  total_relationship_count: number
  by_type: Record<string, number>
}

interface AssetUploadResult {
  asset: AssetMetadata
  created: boolean
  idempotent: boolean
}

let cachedProject: { repository: string; projectId: string } | null = null

function connection() {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new Error('Settings хэсэгт backend URL, token болон repository тохируулна уу.')
  return settings
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null
  const raw = typeof payload?.error === 'string' ? payload.error : ''
  if (response.status === 401) return 'Нэвтрэх token буруу эсвэл хугацаа дууссан байна.'
  if (response.status === 403) return 'Энэ хүсэлтэд permission хүрэхгүй эсвэл app origin зөвшөөрөгдөөгүй байна.'
  if (response.status === 409 && /referenced/i.test(raw)) return 'Файл өөр идэвхтэй холбоостой тул аюулгүй байдлын үүднээс устгасангүй.'
  if (response.status === 409 && /upload.*progress/i.test(raw)) return 'Энэ Asset-ийн upload өөр хүсэлтээр үргэлжилж байна. Дараа нь дахин оролдоно уу.'
  if (response.status === 413) return 'Файл server-ийн зөвшөөрсөн хэмжээнээс их байна.'
  if (response.status === 415) return 'Файлын MIME төрөл server-ийн бодлоготой тохирохгүй байна.'
  if (response.status === 422) return 'Файлын хэмжээ эсвэл SHA-256 integrity шалгалт таарсангүй.'
  return raw.trim() || `${fallback} (${response.status})`
}

async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const settings = connection()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${settings.authToken}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${settings.backendUrl}${path}`, { ...init, headers })
  } catch {
    throw new Error('Backend-тэй холбогдож чадсангүй. Сүлжээ эсвэл app origin тохиргоог шалгаад Retry дарна уу.')
  }
  if (!response.ok) throw new Error(await errorMessage(response, 'Asset хүсэлт амжилтгүй'))
  return response.json() as Promise<T>
}

export async function resolveCurrentProjectId(): Promise<string> {
  const settings = connection()
  const repository = `${settings.owner}/${settings.repo}`.toLowerCase()
  if (cachedProject?.repository === repository) return cachedProject.projectId
  const envelope = await jsonRequest<ActionEnvelope<{ items: ProjectListItem[] }>>('/api/actions/projects_list', {
    method: 'POST',
    body: JSON.stringify({ limit: 50 }),
  })
  if (!envelope.ok || !envelope.result) {
    const message = [envelope.error?.message, envelope.error?.action_required].filter(Boolean).join(' ')
    throw new Error(message || 'Project registry унших амжилтгүй.')
  }
  const project = envelope.result.items.find((item) => item.repository.toLowerCase() === repository)
  if (!project) throw new Error('Project registry-д одоогийн repository олдсонгүй.')
  cachedProject = { repository, projectId: project.id }
  return project.id
}

export async function hashFileSha256(file: File, signal?: AbortSignal): Promise<string> {
  if (!crypto.subtle) throw new Error('Энэ browser Web Crypto SHA-256 дэмжихгүй байна.')
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const bytes = await file.arrayBuffer()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function registerChatAsset(
  file: File,
  sha256: string,
  requestedAssetId: string,
): Promise<AssetRegistrationResult> {
  const projectId = await resolveCurrentProjectId()
  const mediaType = normalizeAttachmentMediaType(file.name, file.type)
  return jsonRequest<AssetRegistrationResult>('/api/brain/assets', {
    method: 'POST',
    body: JSON.stringify({
      asset_id: requestedAssetId,
      project_id: projectId,
      mission_id: null,
      source_id: null,
      filename: file.name,
      display_name: file.name,
      media_type: mediaType,
      size_bytes: file.size,
      sha256,
      upload_status: 'pending',
      processing_status: 'not_requested',
      origin: 'owner_upload',
      sensitivity: 'private',
      idempotency_key: requestedAssetId,
      created_by: 'bestcode-pwa-chat',
      provenance: {
        actor_type: 'owner',
        actor_id: 'bestcode-pwa-chat',
        tool: 'ai-chat-attachment-ui',
      },
    }),
  })
}

export async function readAsset(assetId: string): Promise<AssetMetadata> {
  return jsonRequest<AssetMetadata>(`/api/brain/assets/${encodeURIComponent(assetId)}`)
}

export function uploadAssetContent(
  assetId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<AssetUploadResult> {
  const settings = connection()
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    request.open('PUT', `${settings.backendUrl}/api/brain/assets/${encodeURIComponent(assetId)}/content`)
    request.setRequestHeader('Authorization', `Bearer ${settings.authToken}`)
    request.setRequestHeader('Content-Type', normalizeAttachmentMediaType(file.name, file.type))
    request.responseType = 'json'
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    request.onerror = () => reject(new Error('Сүлжээ эсвэл app origin алдааны улмаас upload дууссан эсэхийг баталгаажуулж чадсангүй. Retry ашиглана уу.'))
    request.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    request.onload = () => {
      signal?.removeEventListener('abort', abort)
      const payload = request.response as AssetUploadResult | { error?: unknown } | null
      if (request.status >= 200 && request.status < 300 && payload && 'asset' in payload) {
        onProgress(100)
        resolve(payload)
        return
      }
      const raw = payload && 'error' in payload && typeof payload.error === 'string' ? payload.error : ''
      if (request.status === 409 && /upload.*progress/i.test(raw)) {
        reject(new Error('Энэ Asset-ийн upload өөр хүсэлтээр үргэлжилж байна. Түр хүлээгээд Retry дарна уу.'))
      } else if (request.status === 413) {
        reject(new Error('Файл server-ийн зөвшөөрсөн хэмжээнээс их байна.'))
      } else if (request.status === 415) {
        reject(new Error('Файлын MIME төрөл server-ийн бодлоготой тохирохгүй байна.'))
      } else if (request.status === 422) {
        reject(new Error('Файлын SHA-256 эсвэл хэмжээний integrity шалгалт таарсангүй.'))
      } else {
        reject(new Error(raw || `Upload амжилтгүй (${request.status}).`))
      }
    }
    request.send(file)
  })
}

export async function getAssetReferences(assetId: string): Promise<AssetReferenceSummary> {
  return jsonRequest<AssetReferenceSummary>(`/api/brain/assets/${encodeURIComponent(assetId)}/references`)
}

export async function deleteAssetContent(assetId: string): Promise<void> {
  await jsonRequest(`/api/brain/assets/${encodeURIComponent(assetId)}/content`, { method: 'DELETE' })
}

export async function linkAssetToMission(assetId: string, missionId: string): Promise<void> {
  await jsonRequest(`/api/brain/assets/${encodeURIComponent(assetId)}/links`, {
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
  })
}

export function toChatAttachmentReference(asset: AssetMetadata, missionId: string | null = asset.mission_id): ChatAttachmentReference {
  if (asset.upload_status !== 'stored') throw new Error('Asset binary бүрэн хадгалагдаагүй байна.')
  return {
    asset_id: asset.asset_id,
    project_id: asset.project_id,
    filename: asset.filename,
    media_type: asset.media_type,
    size_bytes: asset.size_bytes,
    sha256: asset.sha256,
    upload_status: 'stored',
    processing_status: asset.processing_status,
    mission_id: missionId,
  }
}
