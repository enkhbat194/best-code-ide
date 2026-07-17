export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  toolCalls?: ToolCall[]
  createdAt: number
}

export interface FileEntry {
  path: string
  isDir: boolean
}
