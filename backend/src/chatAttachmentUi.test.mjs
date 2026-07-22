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
  filename: 'manual.pdf',
  media_type: 'application/pdf',
  size_bytes: 2048,
  sha256: 'a'.repeat(64),
  upload_status: 'stored',
  processing_status: 'not_requested',
  mission_id: '22222222-2222-4222-8222-222222222222',
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

test('chat request serialization includes bounded Asset reference metadata and an anti-hallucination contract', () => {
  const serialized = serializeAssetReferences([reference])
  assert.match(serialized, /BESTCODE_ASSET_REFERENCES_V1/)
  assert.match(serialized, /"asset_id"/)
  assert.match(serialized, /"filename":"manual.pdf"/)
  assert.match(serialized, /"media_type":"application\/pdf"/)
  assert.match(serialized, /"size_bytes":2048/)
  assert.match(serialized, /"mission_id"/)
  assert.match(serialized, /binary contents were not extracted/)
  assert.doesNotMatch(serialized, /sha256/)
})

test('upload client uses Web Crypto and authenticated backend APIs, never direct bucket access', () => {
  assert.match(assetClientSource, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(assetClientSource, /new XMLHttpRequest\(\)/)
  assert.match(assetClientSource, /request\.upload\.onprogress/)
  assert.match(assetClientSource, /Authorization.*Bearer/)
  assert.match(assetClientSource, /\/api\/brain\/assets\/\$\{encodeURIComponent\(assetId\)\}\/content/)
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
  assert.match(attachmentStoreSource, /cleanupEligible: false/)
})

test('Chat UI exposes separate Photos and Files pickers with mobile accessibility and all required states', () => {
  assert.match(chatViewSource, /accept="image\/\*"/)
  assert.equal((chatViewSource.match(/multiple/g) ?? []).length >= 2, true)
  assert.match(chatViewSource, /Photos/)
  assert.match(chatViewSource, /Files/)
  assert.match(chatViewSource, /aria-live="polite"/)
  assert.match(chatViewSource, /aria-expanded=\{pickerOpen\}/)
  assert.match(chatViewSource, /Message илгээхийн өмнө бүх attachment upload бүрэн дуусах ёстой/)
  assert.match(chatViewSource, /Файл найдвартай хадгалагдлаа\. Агуулгыг AI-аар унших боломж дараагийн processing багцаар нэмэгдэнэ\./)
  assert.match(chatCssSource, /min-width: 44px/)
  assert.match(chatCssSource, /env\(safe-area-inset-bottom\)/)
  assert.match(chatCssSource, /@media \(max-width: 390px\)/)
})

test('user and assistant messages persist Asset references while the model receives metadata only', () => {
  assert.match(chatStoreSource, /attachments,\s*createdAt/)
  assert.match(chatStoreSource, /role: 'assistant',[\s\S]*attachments/)
  assert.match(chatStoreSource, /message\.role === 'user' \? message\.attachments : undefined/)
  assert.match(localAgentSource, /serializeAssetReferences/)
  assert.match(localAgentSource, /The model has not received the binary file/)
  assert.match(localAgentSource, /Never claim that an image, PDF, audio, video, document, archive/)
  assert.doesNotMatch(localAgentSource, /OCR tool|transcribe_audio|extract_pdf/i)
})
