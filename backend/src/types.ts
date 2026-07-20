export interface Env {
  DEEPSEEK_API_KEY?: string
  GITHUB_TOKEN: string
  AUTH_TOKEN: string
  PROJECTS_JSON?: string
  MCP_ALLOWED_ORIGINS?: string
  CORS_ALLOWED_ORIGINS?: string
  ENABLE_LEGACY_AGENT?: string
  ENABLE_LEGACY_REST_WRITES?: string
  REQUIRE_APPROVALS?: string
  MAX_REQUEST_BYTES?: string
  MAX_CHAT_REQUEST_BYTES?: string
  MAX_FILE_REQUEST_BYTES?: string
  MAX_WORKSPACE_REQUEST_BYTES?: string
  RATE_LIMIT_REQUESTS?: string
  RATE_LIMIT_WINDOW_MS?: string
  CF_VERSION_METADATA?: {
    id: string
    tag?: string
    timestamp: string
  }
  APPROVALS: DurableObjectNamespace
}

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCallFunction {
  name: string
  arguments: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: ToolCallFunction
}

export interface ChatCompletionMessage {
  role: Role
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface RepoContext {
  owner: string
  repo: string
  branch: string
}
