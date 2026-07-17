import type { ChatCompletionMessage, Role, ToolCall } from './types'
import { toolSchemas } from './tools'

interface StreamCallbacks {
  onTextDelta: (delta: string) => void
}

interface RawToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** Streams a DeepSeek chat completion and assembles the final message (content + tool_calls). */
export async function streamChat(
  apiKey: string,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
): Promise<ChatCompletionMessage> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      tools: toolSchemas,
      tool_choice: 'auto',
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`DeepSeek error ${res.status}: ${text}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const toolCallAcc: { id: string; name: string; arguments: string }[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let json: {
        choices?: { delta?: { content?: string; tool_calls?: RawToolCallDelta[] }; finish_reason?: string }[]
      }
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      const delta = json.choices?.[0]?.delta
      if (!delta) continue

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content
        callbacks.onTextDelta(delta.content)
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index
          if (!toolCallAcc[i]) toolCallAcc[i] = { id: '', name: '', arguments: '' }
          if (tc.id) toolCallAcc[i].id = tc.id
          if (tc.function?.name) toolCallAcc[i].name = tc.function.name
          if (tc.function?.arguments) toolCallAcc[i].arguments += tc.function.arguments
        }
      }
    }
  }

  const message: ChatCompletionMessage = { role: 'assistant' as Role, content: content || null }
  const realToolCalls = toolCallAcc.filter(Boolean)
  if (realToolCalls.length > 0) {
    message.tool_calls = realToolCalls.map(
      (tc, i): ToolCall => ({
        id: tc.id || `call_${i}`,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }),
    )
  }
  return message
}
