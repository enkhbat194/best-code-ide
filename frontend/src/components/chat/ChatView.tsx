import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCircle2,
  FileAudio,
  FileText,
  FileUp,
  GitBranch,
  ImagePlus,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Square,
  X,
} from 'lucide-react'
import { attachmentStatusLabel, extractExplicitMissionId, formatBytes, getChatAttachmentConfig } from '../../lib/chatAttachmentPolicy'
import { getMission } from '../../lib/missionClient'
import { useAttachmentStore, type AttachmentQueueItem } from '../../store/attachmentStore'
import { useChatStore } from '../../store/chatStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { ChatAttachmentReference } from '../../types'
import { ToolCallCard } from './ToolCallCard'
import styles from './ChatView.module.css'

const attachmentConfig = getChatAttachmentConfig()

export function ChatView() {
  const { messages, isSending, error, send, stop } = useChatStore()
  const attachments = useAttachmentStore((state) => state.items)
  const attachmentNotice = useAttachmentStore((state) => state.notice)
  const queueFiles = useAttachmentStore((state) => state.queueFiles)
  const retryAttachment = useAttachmentStore((state) => state.retry)
  const removeAttachment = useAttachmentStore((state) => state.remove)
  const linkToMission = useAttachmentStore((state) => state.linkToMission)
  const referencesFor = useAttachmentStore((state) => state.referencesFor)
  const consumeAttachments = useAttachmentStore((state) => state.consume)
  const clearAttachmentNotice = useAttachmentStore((state) => state.clearNotice)
  const configured = useSettingsStore((state) => state.isConfigured())
  const owner = useSettingsStore((state) => state.owner)
  const repo = useSettingsStore((state) => state.repo)
  const branch = useSettingsStore((state) => state.branch)
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [composerError, setComposerError] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, attachments])

  const allAttachmentsReady = attachments.every((item) => item.status === 'linked' && item.asset)
  const canSubmit = !isSending && !submitting && Boolean(text.trim() || attachments.length) && allAttachmentsReady

  async function submit() {
    if (!canSubmit) {
      if (attachments.some((item) => item.status === 'failed')) setComposerError('Амжилтгүй attachment-аа Retry хийх эсвэл хасна уу.')
      else if (attachments.length && !allAttachmentsReady) setComposerError('Message илгээхийн өмнө бүх attachment upload бүрэн дуусах ёстой.')
      return
    }

    setSubmitting(true)
    setComposerError('')
    clearAttachmentNotice()
    const queueIds = attachments.map((item) => item.queueId)
    try {
      const missionId = extractExplicitMissionId(text)
      if (missionId) {
        await getMission(missionId)
        await linkToMission(queueIds, missionId)
      }
      const references = referencesFor(queueIds)
      const accepted = await send(text, references)
      if (accepted) {
        consumeAttachments(queueIds)
        setText('')
        setPickerOpen(false)
      }
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  function handlePickedFiles(files: FileList | null) {
    if (files?.length) queueFiles(files)
    setPickerOpen(false)
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.agentHeader}>
        <div className={styles.agentIdentity}>
          <Bot size={17} />
          <div>
            <strong>Best Code Agent</strong>
            <span>DeepSeek provider</span>
          </div>
        </div>
        <div className={styles.repoContext}>
          <span>{owner && repo ? `${owner}/${repo}` : 'Repository тохируулаагүй'}</span>
          <span className={styles.branch}><GitBranch size={12} /> {branch || 'main'}</span>
        </div>
      </header>

      <div className={`${styles.messages} scroll-y`} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            {configured
              ? 'Mission ID өгвөл durable context packet-ийг backend-ээс read-only уншина. Зураг, PDF, аудио болон бусад зөвшөөрөгдсөн файлыг private Asset reference болгон хавсаргаж болно.'
              : 'Эхлээд Settings tab-с backend URL болон token-оо тохируулна уу.'}
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.bubbleRow} ${message.role === 'user' ? styles.user : styles.assistant}`}
          >
            <div className={styles.bubble}>
              {message.content || (isSending && message.role === 'assistant' ? '…' : '')}
              {message.attachments && message.attachments.length > 0 && (
                <MessageAttachments attachments={message.attachments} />
              )}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className={styles.toolCalls}>
                  {message.toolCalls.map((toolCall) => (
                    <ToolCallCard key={toolCall.id} call={toolCall} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {attachments.length > 0 && (
        <section className={styles.attachmentQueue} aria-label="Attachment upload queue" aria-live="polite">
          <div className={styles.attachmentQueueHeader}>
            <strong>Хавсралт</strong>
            <span>{attachments.length}/{attachmentConfig.maxCount}</span>
          </div>
          {attachments.map((item) => (
            <AttachmentQueueRow
              key={item.queueId}
              item={item}
              onRetry={() => retryAttachment(item.queueId)}
              onRemove={() => void removeAttachment(item.queueId)}
            />
          ))}
          {attachments.some((item) => item.status === 'stored' || item.status === 'linked') && (
            <div className={styles.storedNotice}>
              <CheckCircle2 size={16} />
              <span>Файл найдвартай хадгалагдлаа. Агуулгыг AI-аар унших боломж дараагийн processing багцаар нэмэгдэнэ.</span>
            </div>
          )}
        </section>
      )}

      {(error || composerError || attachmentNotice) && (
        <div className={styles.error} role="alert">
          {composerError || attachmentNotice || error}
        </div>
      )}

      {pickerOpen && (
        <div className={styles.pickerActions} role="group" aria-label="Attachment сонгох">
          <button type="button" onClick={() => photoInputRef.current?.click()}>
            <ImagePlus size={18} /> Photos
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={18} /> Files
          </button>
        </div>
      )}

      <input
        ref={photoInputRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        multiple
        aria-label="Photos-оос зураг сонгох"
        onChange={(event: ChangeEvent<HTMLInputElement>) => { handlePickedFiles(event.target.files); event.target.value = '' }}
      />
      <input
        ref={fileInputRef}
        className={styles.hiddenInput}
        type="file"
        multiple
        aria-label="Files-оос файл сонгох"
        onChange={(event: ChangeEvent<HTMLInputElement>) => { handlePickedFiles(event.target.files); event.target.value = '' }}
      />

      <div className={styles.inputBar}>
        <button
          type="button"
          className={styles.attachBtn}
          onClick={() => setPickerOpen((open) => !open)}
          disabled={isSending || submitting || attachments.length >= attachmentConfig.maxCount}
          aria-label="Attachment нэмэх"
          aria-expanded={pickerOpen}
        >
          <Paperclip size={19} />
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder="Mission ID эсвэл хийх ажлаа бичих..."
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setText(event.target.value); setComposerError('') }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {isSending ? (
          <button type="button" className={styles.sendBtn} onClick={stop} aria-label="AI хариуг зогсоох">
            <Square size={16} />
          </button>
        ) : (
          <button type="button" className={styles.sendBtn} onClick={() => void submit()} disabled={!canSubmit} aria-label="Message илгээх">
            {submitting ? <LoaderCircle size={18} className={styles.spinning} /> : <ArrowUp size={18} />}
          </button>
        )}
      </div>
    </div>
  )
}

function AttachmentQueueRow({
  item,
  onRetry,
  onRemove,
}: {
  item: AttachmentQueueItem
  onRetry: () => void
  onRemove: () => void
}) {
  const Icon = item.mediaType.startsWith('audio/') ? FileAudio : item.mediaType.startsWith('image/') ? ImagePlus : FileText
  return (
    <div className={`${styles.attachmentRow} ${item.status === 'failed' ? styles.attachmentFailed : ''}`}>
      <Icon size={19} aria-hidden="true" />
      <div className={styles.attachmentInfo}>
        <strong title={item.filename}>{item.filename}</strong>
        <span>{item.mediaType} · {formatBytes(item.sizeBytes)}</span>
        <span className={styles.attachmentStatus}>
          {item.status === 'failed' ? <AlertCircle size={13} /> : item.status === 'linked' ? <CheckCircle2 size={13} /> : <LoaderCircle size={13} className={item.status === 'selected' ? '' : styles.spinning} />}
          {attachmentStatusLabel(item.status)}{item.status === 'uploading' ? ` · ${item.progress}%` : ''}
        </span>
        {item.status === 'uploading' && <progress max={100} value={item.progress} aria-label={`${item.filename} upload progress`} />}
        {item.error && <span className={styles.attachmentError}>{item.error}</span>}
      </div>
      <div className={styles.attachmentActions}>
        {item.status === 'failed' && item.file && (
          <button type="button" onClick={onRetry} aria-label={`${item.filename} дахин upload хийх`}><RefreshCw size={17} /></button>
        )}
        <button type="button" onClick={onRemove} aria-label={`${item.filename} attachment хасах`}><X size={18} /></button>
      </div>
    </div>
  )
}

function MessageAttachments({ attachments }: { attachments: ChatAttachmentReference[] }) {
  return (
    <div className={styles.messageAttachments} aria-label="Asset references">
      {attachments.map((attachment) => (
        <div className={styles.messageAttachment} key={attachment.asset_id}>
          <Paperclip size={14} />
          <div>
            <strong>{attachment.filename}</strong>
            <span>{attachment.media_type} · {formatBytes(attachment.size_bytes)}</span>
            <code>{attachment.asset_id}</code>
          </div>
        </div>
      ))}
    </div>
  )
}
