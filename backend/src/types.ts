export interface Env {
  DEEPSEEK_API_KEY: string
  GITHUB_TOKEN: string
  AUTH_TOKEN: string
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
