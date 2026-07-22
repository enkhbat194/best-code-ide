export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
}

export interface ChatAttachmentReference {
  asset_id: string
  project_id: string
  filename: string
  media_type: string
  size_bytes: number
  sha256: string
  upload_status: 'stored'
  processing_status: 'not_requested' | 'queued' | 'processing' | 'ready' | 'failed' | 'unsupported'
  mission_id: string | null
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
