import { streamChat } from './deepseek'
import { executeTool } from './tools'
import { jsonError, CORS_HEADERS } from './utils'
import type { ChatCompletionMessage, Env, RepoContext, Role } from './types'

const MAX_TOOL_ITERATIONS = 8
const MAX_RESULT_CHARS = 4000

interface ChatRequestBody {
  messages: { role: string; content: string }[]
  owner: string
  repo: string
  branch?: string
}

export async function handleChat(req: Request, env: Env): Promise<Response> {
  let body: ChatRequestBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body')
  }

  const { messages: clientMessages, owner, repo } = body
  const branch = body.branch || 'main'
  if (!owner || !repo) return jsonError('owner and repo are required')
  if (!Array.isArray(clientMessages)) return jsonError('messages must be an array')

  const ctx: RepoContext = { owner, repo, branch }
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))

      try {
        const systemPrompt =
          `You are a coding assistant embedded in a mobile iPhone app. You have direct tool access to ` +
          `the GitHub repository ${owner}/${repo} on branch "${branch}" via list_files, read_file, ` +
          `write_file, delete_file, and list_commits. Use them to carry out what the user asks — reading, ` +
          `writing, and committing code directly, the same way you would as a coding agent in a terminal. ` +
          `Always read a file before editing it if you haven't seen its current content. Keep replies short; ` +
          `after making changes, briefly summarize what changed.`

        const messages: ChatCompletionMessage[] = [
          { role: 'system', content: systemPrompt },
          ...clientMessages.map((m) => ({ role: m.role as Role, content: m.content })),
        ]

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const assistantMsg = await streamChat(env.DEEPSEEK_API_KEY, messages, {
            onTextDelta: (delta) => send({ type: 'text_delta', delta }),
          })
          messages.push(assistantMsg)

          if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) break

          for (const tc of assistantMsg.tool_calls) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(tc.function.arguments || '{}')
            } catch {
              /* malformed args from the model — proceed with empty object */
            }

            send({ type: 'tool_call', id: tc.id, name: tc.function.name, args })

            let result: string
            let isError = false
            try {
              result = await executeTool(tc.function.name, args, env.GITHUB_TOKEN, ctx)
            } catch (err) {
              result = err instanceof Error ? err.message : String(err)
              isError = true
            }

            send({ type: 'tool_result', id: tc.id, result: result.slice(0, MAX_RESULT_CHARS), error: isError })
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
          }
        }

        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', ...CORS_HEADERS },
  })
}
