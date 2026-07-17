import { streamChat } from './deepseek'
import { executeTool } from './tools'
import { jsonError, resolveSecret, CORS_HEADERS } from './utils'
import type { ChatCompletionMessage, Env, RepoContext, Role } from './types'

const MAX_TOOL_ITERATIONS = 12
const MAX_RESULT_CHARS = 12000

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
        const deepseekKey = resolveSecret(env, 'DEEPSEEK_API_KEY')
        const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
        if (!deepseekKey) {
          send({ type: 'error', message: 'DEEPSEEK_API_KEY secret Worker дээр олдсонгүй.' })
          return
        }
        if (!githubToken) {
          send({ type: 'error', message: 'GITHUB_TOKEN secret Worker дээр олдсонгүй.' })
          return
        }

        const systemPrompt = `You are Best Code IDE Agent, a repository-aware software engineering agent running inside a mobile IDE.
Current model provider: DeepSeek. Never claim that you are Claude, ChatGPT, Codex, Gemini, or another provider.
Selected repository: ${owner}/${repo}
Selected branch: ${branch}

Your job is to inspect, modify, validate, and explain code using the provided repository tools.
Mandatory workflow for non-trivial coding tasks:
1. Inspect the repository structure with list_tree or list_files.
2. Locate relevant code with search_code.
3. Read the current files before editing; use read_files for related files.
4. If the selected branch is main or master, create a working branch named agent/<short-task> before making broad or risky changes, then tell the user to switch the app branch setting. Do not pretend that the selected branch changed automatically.
5. Make minimal, coherent edits. Never say a file was changed unless write_file/delete_file confirms it.
6. Compare the working branch against its base with compare_branches.
7. Run validation when validate.yml exists, then check validation_status.
8. Report exactly what was verified and what remains unverified.

Do not fabricate file contents, command output, build results, commits, or deployment status. Keep prose concise, but use tools thoroughly.`

        const safeClientMessages = clientMessages
          .filter((message) => message && typeof message.content === 'string' && message.content.trim())
          .map((message) => ({ role: message.role as Role, content: message.content }))

        const messages: ChatCompletionMessage[] = [
          { role: 'system', content: systemPrompt },
          ...safeClientMessages,
        ]

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const assistantMsg = await streamChat(deepseekKey, messages, {
            onTextDelta: (delta) => send({ type: 'text_delta', delta }),
          })
          messages.push(assistantMsg)

          if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) break

          for (const tc of assistantMsg.tool_calls) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(tc.function.arguments || '{}')
            } catch {
              // The model supplied malformed arguments; executeTool will return a useful validation error.
            }

            send({ type: 'tool_call', id: tc.id, name: tc.function.name, args })

            let result: string
            let isError = false
            try {
              result = await executeTool(tc.function.name, args, githubToken, ctx)
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
