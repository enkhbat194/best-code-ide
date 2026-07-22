import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  deleteAssetContent,
  getAssetReferences,
  hashFileSha256,
  linkAssetToMission,
  readAsset,
  registerChatAsset,
  toChatAttachmentReference,
  uploadAssetContent,
} from '../lib/assetClient'
import {
  getChatAttachmentConfig,
  preflightChatAttachment,
  type ChatAttachmentStatus,
} from '../lib/chatAttachmentPolicy'
import type { ChatAttachmentReference } from '../types'

export interface AttachmentQueueItem {
  queueId: string
  requestedAssetId: string
  filename: string
  mediaType: string
  sizeBytes: number
  lastModified: number
  status: ChatAttachmentStatus
  progress: number
  error: string | null
  asset: ChatAttachmentReference | null
  cleanupEligible: boolean
  duplicate: boolean
  file?: File
}

interface AttachmentState {
  items: AttachmentQueueItem[]
  notice: string | null
  queueFiles: (files: FileList | File[]) => void
  retry: (queueId: string) => void
  remove: (queueId: string) => Promise<void>
  linkToMission: (queueIds: string[], missionId: string) => Promise<void>
  referencesFor: (queueIds: string[]) => ChatAttachmentReference[]
  consume: (queueIds: string[]) => void
  clearNotice: () => void
}

const activeControllers = new Map<string, AbortController>()

function updateQueueItem(queueId: string, patch: Partial<AttachmentQueueItem>): void {
  useAttachmentStore.setState((state) => ({
    items: state.items.map((item) => item.queueId === queueId ? { ...item, ...patch } : item),
  }))
}

function currentItem(queueId: string): AttachmentQueueItem | null {
  return useAttachmentStore.getState().items.find((item) => item.queueId === queueId) ?? null
}

async function cleanupCreatedAsset(assetId: string): Promise<string | null> {
  try {
    const references = await getAssetReferences(assetId)
    if (references.active_reference_count > 0) {
      return `Файлыг queue-ээс хассан. Asset ${references.active_reference_count} идэвхтэй холбоостой тул server дээр устгаагүй.`
    }
    await deleteAssetContent(assetId)
    return null
  } catch (cause) {
    return `Файлыг queue-ээс хассан. Cleanup баталгаажаагүй тул Asset-ийг аюулгүй байдлын үүднээс server дээр үлдээлээ. ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

async function processQueueItem(queueId: string): Promise<void> {
  const initial = currentItem(queueId)
  if (!initial?.file) {
    if (initial) updateQueueItem(queueId, { status: 'failed', error: 'App reload-ын дараа дуусаагүй File/Blob хадгалагддаггүй. Файлаа дахин сонгоно уу.' })
    return
  }

  activeControllers.get(queueId)?.abort()
  const controller = new AbortController()
  activeControllers.set(queueId, controller)
  let registeredAsset: ChatAttachmentReference | null = initial.asset
  let registeredAssetId: string | null = initial.asset?.asset_id ?? null
  let cleanupEligible = initial.cleanupEligible

  try {
    updateQueueItem(queueId, { status: 'hashing', progress: 0, error: null })
    const sha256 = await hashFileSha256(initial.file, controller.signal)
    if (!currentItem(queueId) || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')

    updateQueueItem(queueId, { status: 'registering', progress: 0 })
    const registration = await registerChatAsset(initial.file, sha256, initial.requestedAssetId)
    cleanupEligible = cleanupEligible || (registration.created && !registration.duplicate)
    registeredAssetId = registration.asset.asset_id

    if (controller.signal.aborted || !currentItem(queueId)) {
      if (cleanupEligible) await cleanupCreatedAsset(registration.asset.asset_id)
      return
    }

    updateQueueItem(queueId, {
      filename: registration.asset.filename,
      mediaType: registration.asset.media_type,
      sizeBytes: registration.asset.size_bytes,
      cleanupEligible,
      duplicate: registration.duplicate,
    })

    let asset = registration.asset
    if (asset.upload_status === 'uploading') {
      asset = await readAsset(asset.asset_id)
    }
    if (asset.upload_status === 'stored') {
      registeredAsset = toChatAttachmentReference(asset)
      updateQueueItem(queueId, { asset: registeredAsset, status: 'stored', progress: 100 })
      updateQueueItem(queueId, { status: 'linked' })
      return
    }
    if (asset.upload_status === 'uploading') {
      throw new Error('Энэ Asset-ийн upload өөр хүсэлтээр үргэлжилж байна. Түр хүлээгээд Retry дарна уу.')
    }
    if (asset.upload_status === 'deleted') {
      throw new Error('Ижил binary-тэй Asset өмнө нь устгагдсан байна. Restore/re-upload шийдвэр тусдаа шаардлагатай.')
    }

    updateQueueItem(queueId, { status: 'uploading', progress: 1 })
    const uploaded = await uploadAssetContent(
      asset.asset_id,
      initial.file,
      (progress) => updateQueueItem(queueId, { progress }),
      controller.signal,
    )
    registeredAsset = toChatAttachmentReference(uploaded.asset)
    if (controller.signal.aborted || !currentItem(queueId)) {
      if (cleanupEligible) await cleanupCreatedAsset(registeredAsset.asset_id)
      return
    }
    updateQueueItem(queueId, { asset: registeredAsset, status: 'stored', progress: 100 })
    updateQueueItem(queueId, { status: 'linked' })
  } catch (cause) {
    const removed = !currentItem(queueId)
    const aborted = controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')
    if (removed || aborted) {
      if (cleanupEligible && registeredAssetId) await cleanupCreatedAsset(registeredAssetId)
      return
    }
    updateQueueItem(queueId, {
      status: 'failed',
      error: cause instanceof Error ? cause.message : String(cause),
      progress: 0,
      asset: registeredAsset,
      cleanupEligible,
    })
  } finally {
    if (activeControllers.get(queueId) === controller) activeControllers.delete(queueId)
  }
}

export const useAttachmentStore = create<AttachmentState>()(
  persist(
    (set, get) => ({
      items: [],
      notice: null,

      queueFiles: (files) => {
        const config = getChatAttachmentConfig()
        const incoming = Array.from(files)
        const existing = get().items
        const additions: AttachmentQueueItem[] = []
        const errors: string[] = []
        for (const file of incoming) {
          if (existing.length + additions.length >= config.maxCount) {
            errors.push(`Нэг message-д хамгийн ихдээ ${config.maxCount} attachment зөвшөөрнө.`)
            break
          }
          const duplicateInQueue = [...existing, ...additions].some((item) =>
            item.filename === file.name && item.sizeBytes === file.size && item.lastModified === file.lastModified)
          if (duplicateInQueue) {
            errors.push(`${file.name}: queue-д аль хэдийн байна.`)
            continue
          }
          try {
            const preflight = preflightChatAttachment(file, existing.length + additions.length, config)
            additions.push({
              queueId: crypto.randomUUID(),
              requestedAssetId: crypto.randomUUID(),
              filename: preflight.filename,
              mediaType: preflight.mediaType,
              sizeBytes: preflight.sizeBytes,
              lastModified: file.lastModified,
              status: 'selected',
              progress: 0,
              error: null,
              asset: null,
              cleanupEligible: false,
              duplicate: false,
              file,
            })
          } catch (cause) {
            errors.push(`${file.name || 'Файл'}: ${cause instanceof Error ? cause.message : String(cause)}`)
          }
        }
        if (additions.length === 0) {
          set({ notice: errors.join(' ') || 'Нэмэх файл олдсонгүй.' })
          return
        }
        set({ items: [...existing, ...additions], notice: errors.length ? errors.join(' ') : null })
        for (const item of additions) void processQueueItem(item.queueId)
      },

      retry: (queueId) => {
        const item = get().items.find((candidate) => candidate.queueId === queueId)
        if (!item) return
        if (!item.file) {
          updateQueueItem(queueId, { status: 'failed', error: 'Retry хийхийн тулд файлаа дахин сонгоно уу.' })
          return
        }
        void processQueueItem(queueId)
      },

      remove: async (queueId) => {
        const item = get().items.find((candidate) => candidate.queueId === queueId)
        if (!item) return
        activeControllers.get(queueId)?.abort()
        let notice: string | null = null
        if (item.cleanupEligible && item.asset) notice = await cleanupCreatedAsset(item.asset.asset_id)
        set((state) => ({ items: state.items.filter((candidate) => candidate.queueId !== queueId), notice }))
      },

      linkToMission: async (queueIds, missionId) => {
        const selected = get().items.filter((item) => queueIds.includes(item.queueId))
        for (const item of selected) {
          if (!item.asset || item.status !== 'linked') throw new Error(`${item.filename}: upload бүрэн дуусаагүй байна.`)
          if (item.asset.mission_id === missionId) continue
          await linkAssetToMission(item.asset.asset_id, missionId)
          updateQueueItem(item.queueId, { asset: { ...item.asset, mission_id: missionId } })
        }
      },

      referencesFor: (queueIds) => get().items
        .filter((item) => queueIds.includes(item.queueId) && item.status === 'linked' && item.asset)
        .map((item) => item.asset as ChatAttachmentReference),

      consume: (queueIds) => set((state) => ({
        items: state.items.filter((item) => !queueIds.includes(item.queueId)),
        notice: null,
      })),

      clearNotice: () => set({ notice: null }),
    }),
    {
      name: 'bestcode-chat-attachment-queue-v1',
      partialize: (state) => ({
        items: state.items
          .filter((item) => item.status === 'stored' || item.status === 'linked')
          .map((item) => ({
            queueId: item.queueId,
            requestedAssetId: item.requestedAssetId,
            filename: item.filename,
            mediaType: item.mediaType,
            sizeBytes: item.sizeBytes,
            lastModified: item.lastModified,
            status: item.status,
            progress: item.progress,
            error: item.error,
            asset: item.asset,
            cleanupEligible: item.cleanupEligible,
            duplicate: item.duplicate,
          })),
        notice: null,
      }),
    },
  ),
)
