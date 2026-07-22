export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
}

export type AssetProcessingStatus = 'not_requested' | 'queued' | 'processing' | 'ready' | 'failed' | 'unsupported'

export interface ChatAttachmentReference {
  asset_id: string
  project_id: string
  filename: string
  media_type: string
  size_bytes: number
  sha256: string
  upload_status: 'stored'
  processing_status: AssetProcessingStatus
  mission_id: string | null
}

export interface ProcessingJobReference {
  schema: 'processing-job-v1'
  job_id: string
  asset_id: string
  project_id: string
  mission_id: string | null
  status: Exclude<AssetProcessingStatus, 'not_requested'>
  attempt_count: number
  processor_name: string
  processor_version: string
  started_at: string | null
  completed_at: string | null
  safe_error_code: string | null
  idempotency_key: string
  cache_key: string
  source_checksum: string
  result_object_id: string | null
  created_at: string
  updated_at: string
}

export interface ProcessingResultReference {
  schema: 'processing-result-v1'
  asset_id: string
  project_id: string
  mission_id: string | null
  media_type: string
  summary: string
  visible_text: string
  objects: string[]
  concepts: string[]
  code_or_ui_detected: boolean
  language: string | null
  confidence: number
  warnings: string[]
  provenance: {
    contract: 'provider-neutral-vision-v1'
    processor_name: string
    processor_version: string
    derived_interpretation: true
    extracted_text_untrusted: true
    provider_request_id: string | null
  }
  source_checksum: string
  created_at: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  attachments?: ChatAttachmentReference[]
  toolCalls?: ToolCall[]
  createdAt: number
}

export interface FileEntry {
  path: string
  isDir: boolean
}
