import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

interface LlmRequestBody {
  messages: unknown[]
  tools?: unknown[]
}

/**
 * Thin authenticated proxy for one DeepSeek chat-completions call. The agent
 * loop for the local-first workspace runs in the browser; only the model call
 * comes through here so the API key never leaves the Worker.
 */
export async function handleLlm(req: Request, env: Env): Promise<Response> {
  const key = resolveSecret(env, 'DEEPSEEK_API_KEY')
  if (!key) return jsonError('DEEPSEEK_API_KEY secret Worker дээр олдсонгүй', 500)

  let body: LlmRequestBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body')
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError('messages must be a non-empty array')
  }
  if (body.messages.length > 200) return jsonError('Too many messages')
  if (body.tools !== undefined && !Array.isArray(body.tools)) return jsonError('tools must be an array')

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: body.messages,
      ...(body.tools && body.tools.length > 0 ? { tools: body.tools, tool_choice: 'auto' } : {}),
      stream: false,
    }),
  })

  const text = await res.text()
  if (!res.ok) return jsonError(`DeepSeek error ${res.status}: ${text}`, 502)

  let data: { choices?: { message?: unknown }[] }
  try {
    data = JSON.parse(text)
  } catch {
    return jsonError('DeepSeek returned malformed JSON', 502)
  }
  return jsonResponse({ message: data.choices?.[0]?.message ?? null })
}
