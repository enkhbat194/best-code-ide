import type { ChatMessage } from '../types'

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: string; error?: boolean }
  | { type: 'branch_changed'; branch: string }
  | { type: 'error'; message: string }
  | { type: 'done'; branch?: string }

interface SendChatParams {
  backendUrl: string
  authToken: string
  messages: Pick<ChatMessage, 'role' | 'content'>[]
  owner: string
  repo: string
  branch: string
  signal?: AbortSignal
}

/**
 * Streams the agent's reply as newline-delimited JSON events from the Worker.
 * Each line is one StreamEvent; onEvent is called as they arrive.
 */
export async function sendChat(params: SendChatParams, onEvent: (event: StreamEvent) => void): Promise<void> {
  const { backendUrl, authToken, messages, owner, repo, branch, signal } = params

  const res = await fetch(`${backendUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ messages, owner, repo, branch }),
    signal,
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Backend error ${res.status}: ${text}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line) as StreamEvent)
      } catch {
        // Ignore malformed lines rather than aborting the whole stream.
      }
    }
  }

  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as StreamEvent)
    } catch {
      /* trailing partial line, ignore */
    }
  }
}
