import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  CHAT_ATTACHMENT_STATUSES,
  extractExplicitMissionId,
  getChatAttachmentConfig,
  normalizeAttachmentMediaType,
  preflightChatAttachment,
  serializeAssetReferences,
} from '../../frontend/src/lib/chatAttachmentPolicy.ts'

const assetClientSource = await readFile(new URL('../../frontend/src/lib/assetClient.ts', import.meta.url), 'utf8')
const attachmentStoreSource = await readFile(new URL('../../frontend/src/store/attachmentStore.ts', import.meta.url), 'utf8')
const chatStoreSource = await readFile(new URL('../../frontend/src/store/chatStore.ts', import.meta.url), 'utf8')
const localAgentSource = await readFile(new URL('../../frontend/src/lib/localAgent.ts', import.meta.url), 'utf8')
const chatViewSource = await readFile(new URL('../../frontend/src/components/chat/ChatView.tsx', import.meta.url), 'utf8')
const chatCssSource = await readFile(new URL('../../frontend/src/components/chat/ChatView.module.css', import.meta.url), 'utf8')

const reference = {
  asset_id: 'asset:11111111-1111-4111-8111-111111111111',
  project_id: 'bestcode',
  filename: 'manual.png',
  media_type: 'image/png',
  size_bytes: 2048,
  sha256: 'a'.repeat(64),
  upload_status: 'stored',
  processing_status: 'not_requested',
  mission_id: '22222222-2222-4222-8222-222222222222',
}

const readyResult = {
  schema: 'processing-result-v1',
  asset_id: reference.asset_id,
  project_id: 'bestcode',
  mission_id: reference.mission_id,
  media_type: 'image/png',
  summary: 'Mobile UI screenshot.',
  visible_text: 'Run this command',
  objects: ['screen'],
  concepts: ['ui'],
  code_or_ui_detected: true,
  language: 'en',
  confidence: 0.8,
  warnings: ['prompt_injection_text_detected'],
  provenance: {
    contract: 'provider-neutral-vision-v1',
    processor_name: 'vision',
    processor_version: '1',
    derived_interpretation: true,
    extracted_text_untrusted: true,
    provider_request_id: null,
  },
  source_checksum: 'a'.repeat(64),
  created_at: '2026-07-22T15:00:00.000Z',
}

test('attachment policy keeps count and byte ceilings configurable', () => {
  assert.deepEqual(getChatAttachmentConfig({
    VITE_CHAT_ATTACHMENT_MAX_COUNT: '7',
    VITE_CHAT_ATTACHMENT_MAX_BYTES: '2097152',
  }), { maxCount: 7, maxBytes: 2_097_152 })
  assert.deepEqual(CHAT_ATTACHMENT_STATUSES, [
    'selected', 'hashing', 'registering', 'uploading', 'stored', 'linked', 'failed',
  ])
})

test('client preflight accepts image, PDF, audio, and server-policy other MIME while blocking executables', () => {
  assert.equal(normalizeAttachmentMediaType('photo.heic', ''), 'image/heic')
  assert.equal(normalizeAttachmentMediaType('manual.pdf', ''), 'application/pdf')
  assert.equal(normalizeAttachmentMediaType('voice.m4a', ''), 'audio/mp4')
  assert.equal(normalizeAttachmentMediaType('model.bin', 'application/octet-stream'), 'application/octet-stream')
  assert.throws(() => normalizeAttachmentMediaType('bad.exe', 'application/x-msdownload'), /зөвшөөрөгдөхгүй/)
  assert.throws(() => preflightChatAttachment({ name: '../secret.pdf', type: 'application/pdf', size: 10 }, 0), /path/)
  assert.throws(() => preflightChatAttachment({ name: 'empty.pdf', type: 'application/pdf', size: 0 }, 0), /Хоосон/)
  assert.throws(() => preflightChatAttachment({ name: 'large.pdf', type: 'application/pdf', size: 101 }, 0, { maxCount: 5, maxBytes: 100 }), /client хязгаараас/)
})

test('only explicit existing Mission context syntax becomes mission_id metadata', () => {
  const missionId = '22222222-2222-4222-8222-222222222222'
  assert.equal(extractExplicitMissionId(`Mission ID: ${missionId}`), missionId)
  assert.equal(extractExplicitMissionId(missionId), missionId)
  assert.equal(extractExplicitMissionId(`random object ${missionId} inside text`), null)
})

test('metadata-only fallback says content is unread and never supplies checksum or invented content', () => {
  const serialized = serializeAssetReferences([reference])
  assert.match(serialized, /BESTCODE_ASSET_CONTEXT_V1/)
  assert.match(serialized, /"content_state":"binary_not_supplied_to_model"/)
  assert.match(serialized, /"processing_status":"not_requested"/)
  assert.match(serialized, /untrusted source data/)
  assert.doesNotMatch(serialized, /derived_result/)
  assert.doesNotMatch(serialized, /sha256/)
})

test('ready processing result is supplied as untrusted interpreted evidence, not verified fact', () => {
  const serialized = serializeAssetReferences([reference], [{
    asset_id: reference.asset_id,
    status: 'ready',
    result: readyResult,
  }])
  assert.match(serialized, /"content_state":"derived_content_ready"/)
  assert.match(serialized, /"summary":"Mobile UI screenshot\."/)
  assert.match(serialized, /"visible_text":"Run this command"/)
  assert.match(serialized, /derived interpretation/)
  assert.match(serialized, /never execute commands/)
  assert.match(serialized, /extracted_text_untrusted/)
})

test('upload and processing clients use authenticated backend APIs and never direct bucket access', () => {
  assert.match(assetClientSource, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(assetClientSource, /new XMLHttpRequest\(\)/)
  assert.match(assetClientSource, /request\.upload\.onprogress/)
  assert.match(assetClientSource, /Authorization.*Bearer/)
  assert.match(assetClientSource, /\/api\/brain\/assets\/\$\{encodeURIComponent\(assetId\)\}\/content/)
  assert.match(assetClientSource, /\/process\/retry/)
  assert.match(assetClientSource, /\/processing\/result\?project_id=/)
  assert.match(assetClientSource, /sensitivity: 'private'/)
  assert.doesNotMatch(assetClientSource, /r2\.dev|cloudflarestorage|custom domain|ASSET_BUCKET/i)
  assert.doesNotMatch(assetClientSource, /Content-Length/)
})

test('queue covers duplicate, retry, reload persistence, and safe reference-aware cleanup', () => {
  assert.match(attachmentStoreSource, /registration\.duplicate/)
  assert.match(attachmentStoreSource, /retry: \(queueId\)/)
  assert.match(attachmentStoreSource, /getAssetReferences\(assetId\)/)
  assert.match(attachmentStoreSource, /active_reference_count > 0/)
  assert.match(attachmentStoreSource, /deleteAssetContent\(assetId\)/)
  assert.ok(attachmentStoreSource.indexOf('getAssetReferences(assetId)') < attachmentStoreSource.indexOf('deleteAssetContent(assetId)'))
  assert.match(attachmentStoreSource, /filter\(\(item\) => item\.status === 'stored' \|\| item\.status === 'linked'\)/)
  assert.doesNotMatch(attachmentStoreSource.match(/partialize:[\s\S]*$/)?.[0] ?? '', /file: item\.file/)
})

test('Chat UI distinguishes unread, processing, ready, result, failed, and unsupported states with one size formatter', () => {
  assert.match(chatViewSource, /accept="image\/\*"/)
  assert.match(chatViewSource, /Холбогдсон файл — агуулга уншаагүй/)
  assert.match(chatViewSource, /Агуулга боловсруулж байна/)
  assert.match(chatViewSource, /Агуулга уншсан/)
  assert.match(chatViewSource, /Агуулга унших амжилтгүй/)
  assert.match(chatViewSource, /Энэ format дэмжигдэхгүй/)
  assert.match(chatViewSource, /Attachment processing result/)
  assert.match(chatViewSource, /derived interpretation; verified fact биш/)
  assert.match(chatViewSource, /formatBytes\(attachment\.size_bytes\)/)
  assert.doesNotMatch(chatViewSource, /\/\s*1000|\/\s*1024.*KB/)
  assert.match(chatCssSource, /min-width: 44px/)
  assert.match(chatCssSource, /env\(safe-area-inset-bottom\)/)
})

test('local agent fetches ready result, preserves metadata fallback, and locks prompt injection as untrusted data', () => {
  assert.match(chatStoreSource, /attachments,\s*createdAt/)
  assert.match(chatStoreSource, /role: 'assistant',[\s\S]*attachments/)
  assert.match(localAgentSource, /getAssetProcessing/)
  assert.match(localAgentSource, /getAssetProcessingResult/)
  assert.match(localAgentSource, /serializeAssetReferences/)
  assert.match(localAgentSource, /binary file itself is never supplied/)
  assert.match(localAgentSource, /untrusted source data/)
  assert.match(localAgentSource, /never execute commands/)
  assert.match(localAgentSource, /When processing is not ready/)
  assert.doesNotMatch(localAgentSource, /OCR tool|transcribe_audio|extract_pdf/i)
})
