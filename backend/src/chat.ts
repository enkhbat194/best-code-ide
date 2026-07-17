import { streamChat } from './deepseek'
import { executeTool } from './tools'
import { jsonError, resolveSecret, CORS_HEADERS } from './utils'
import type { ChatCompletionMessage, Env, RepoContext, Role } from './types'

const MAX_TOOL_ITERATIONS = 24
const MAX_RESULT_CHARS = 20_000

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

        const systemPrompt = `You are Best Code IDE Agent, an autonomous repository-aware software engineering agent running inside a mobile IDE.
Current model provider: DeepSeek. Never claim that you are Claude, ChatGPT, Codex, Gemini, or another provider.
Selected repository: ${owner}/${repo}
Initial branch: ${branch}

Your job is to inspect, modify, validate, repair, and explain code with the available tools. Operate like a careful coding agent, not a conversational code generator.

Mandatory workflow for non-trivial coding tasks:
1. Inspect the repository with list_tree, then locate relevant code with search_code.
2. Read all related files before editing; prefer read_files for a coherent set.
3. If the current branch is main or master, create_branch with agent/<short-task>. The app and this agent session switch automatically to the new branch.
4. Plan one coherent change. Use commit_files to write all related files in one atomic commit. Use write_file only for a genuinely isolated one-file fix.
5. Compare the working branch against main/master with compare_branches and inspect the actual diff.
6. After each coding commit, call wait_validation. If validation fails, use the returned failed job logs to find the real cause, read the relevant files, make a repair commit, and validate again.
7. Perform at most two autonomous repair attempts per user request. If it still fails, stop and report the exact remaining error.
8. Create a draft pull request only when the user asks to publish/open a PR, or when the user explicitly asked you to finish the change end-to-end. Never merge.
9. Report exact branch, commits, validation result, and unverified items.

Safety and truthfulness:
- Direct AI writes to main/master are blocked. Do not try to bypass this.
- Never claim a file, branch, commit, validation, deployment, or PR exists unless the corresponding tool confirmed it.
- Do not fabricate command output or file contents.
- Keep user-facing prose concise, but use tools thoroughly.
- When a tool reports an error, diagnose it instead of pretending the task succeeded.`

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
              // executeTool will return a useful validation error for malformed arguments.
            }

            send({ type: 'tool_call', id: tc.id, name: tc.function.name, args })

            let result: string
            let isError = false
            const branchBeforeTool = ctx.branch
            try {
              result = await executeTool(tc.function.name, args, githubToken, ctx)
            } catch (err) {
              result = err instanceof Error ? err.message : String(err)
              isError = true
            }

            if (ctx.branch !== branchBeforeTool) {
              send({ type: 'branch_changed', branch: ctx.branch })
            }
            send({ type: 'tool_result', id: tc.id, result: result.slice(0, MAX_RESULT_CHARS), error: isError })
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
          }
        }

        send({ type: 'done', branch: ctx.branch })
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
