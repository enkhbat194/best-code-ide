import type { ChatAttachmentReference } from '../types'

export const CHAT_ATTACHMENT_STATUSES = [
  'selected',
  'hashing',
  'registering',
  'uploading',
  'stored',
  'linked',
  'failed',
] as const

export type ChatAttachmentStatus = (typeof CHAT_ATTACHMENT_STATUSES)[number]

export interface ChatAttachmentConfig {
  maxCount: number
  maxBytes: number
}

export interface AttachmentCandidate {
  name: string
  type: string
  size: number
}

const DEFAULT_MAX_COUNT = 5
const DEFAULT_MAX_BYTES = 104_857_600
const MAX_CONFIGURED_COUNT = 20
const MAX_CONFIGURED_BYTES = 2_147_483_648
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/
const PATH_ESCAPE = /[\\/\u0000-\u001f\u007f]|%(?:2e|2f|5c)/i
const DANGEROUS_BINARY_MIME = new Set([
  'application/x-dosexec',
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-msdos-program',
  'application/x-msdownload',
  'application/x-sharedlib',
  'application/vnd.microsoft.portable-executable',
])

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  js: 'application/javascript',
  mjs: 'application/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  xml: 'application/xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  zip: 'application/zip',
  gz: 'application/gzip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const runtimeEnv = ((import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env ?? {})

function configuredInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

export function getChatAttachmentConfig(
  env: Record<string, string | boolean | undefined> = runtimeEnv,
): ChatAttachmentConfig {
  return {
    maxCount: configuredInteger(env.VITE_CHAT_ATTACHMENT_MAX_COUNT, DEFAULT_MAX_COUNT, MAX_CONFIGURED_COUNT),
    maxBytes: configuredInteger(env.VITE_CHAT_ATTACHMENT_MAX_BYTES, DEFAULT_MAX_BYTES, MAX_CONFIGURED_BYTES),
  }
}

export function normalizeAttachmentMediaType(filename: string, declaredType: string): string {
  const normalized = declaredType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : ''
  const mediaType = normalized || EXTENSION_MIME[extension] || 'application/octet-stream'
  if (!MIME_PATTERN.test(mediaType)) throw new Error('Файлын MIME төрөл зөв хэлбэртэй биш байна.')
  if (DANGEROUS_BINARY_MIME.has(mediaType)) throw new Error('Энэ төрлийн executable файл аюулгүй байдлын бодлогоор зөвшөөрөгдөхгүй.')
  return mediaType
}

export function preflightChatAttachment(
  candidate: AttachmentCandidate,
  existingCount: number,
  config = getChatAttachmentConfig(),
): { filename: string; mediaType: string; sizeBytes: number } {
  const filename = candidate.name.normalize('NFKC').trim()
  if (!filename || PATH_ESCAPE.test(filename) || filename === '.' || filename === '..') {
    throw new Error('Файлын нэр path эсвэл control тэмдэг агуулсан тул зөвшөөрөхгүй.')
  }
  if (filename.length > 180) throw new Error('Файлын нэр 180 тэмдэгтээс урт байна.')
  if (!Number.isSafeInteger(candidate.size) || candidate.size <= 0) throw new Error('Хоосон эсвэл хэмжээ нь тодорхойгүй файл upload хийхгүй.')
  if (candidate.size > config.maxBytes) {
    throw new Error(`Файл ${formatBytes(config.maxBytes)}-ийн client хязгаараас их байна.`)
  }
  if (existingCount >= config.maxCount) throw new Error(`Нэг message-д хамгийн ихдээ ${config.maxCount} attachment зөвшөөрнө.`)
  return {
    filename,
    mediaType: normalizeAttachmentMediaType(filename, candidate.type),
    sizeBytes: candidate.size,
  }
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function attachmentStatusLabel(status: ChatAttachmentStatus): string {
  switch (status) {
    case 'selected': return 'Сонгогдсон'
    case 'hashing': return 'SHA-256 тооцож байна'
    case 'registering': return 'Asset metadata бүртгэж байна'
    case 'uploading': return 'Private storage руу upload хийж байна'
    case 'stored': return 'Найдвартай хадгалагдсан'
    case 'linked': return 'Message-д хавсаргахад бэлэн'
    case 'failed': return 'Амжилтгүй'
  }
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const LABELED_MISSION_PATTERN = new RegExp(`(?:Mission\\s*ID|mission_id)\\s*[:=#-]?\\s*(${UUID_PATTERN})`, 'i')
const EXACT_MISSION_PATTERN = new RegExp(`^\\s*(${UUID_PATTERN})\\s*$`, 'i')

export function extractExplicitMissionId(text: string): string | null {
  return (LABELED_MISSION_PATTERN.exec(text)?.[1] ?? EXACT_MISSION_PATTERN.exec(text)?.[1] ?? null)?.toLowerCase() ?? null
}

export function serializeAssetReferences(references: ChatAttachmentReference[]): string {
  if (references.length === 0) return ''
  const payload = references.map((reference) => ({
    asset_id: reference.asset_id,
    filename: reference.filename,
    media_type: reference.media_type,
    size_bytes: reference.size_bytes,
    ...(reference.mission_id ? { mission_id: reference.mission_id } : {}),
  }))
  return [
    '[BESTCODE_ASSET_REFERENCES_V1]',
    'Metadata only. The private binary contents were not extracted, opened, transcribed, OCR processed, or supplied to the model. Never claim to understand attachment contents.',
    JSON.stringify({ assets: payload }),
    '[/BESTCODE_ASSET_REFERENCES_V1]',
  ].join('\n')
}
