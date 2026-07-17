import * as vfs from './fs'
import { commitFile } from './backend'
import { importGitHubWorkspace } from './workspace'
import { useFsStore } from '../store/fsStore'
import { useSettingsStore } from '../store/settingsStore'

const MAX_ITERATIONS = 12
const MAX_RESULT_CHARS = 20_000

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: string; error?: boolean }
  | { type: 'error'; message: string }

interface RawToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

interface AssistantMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: RawToolCall[]
}

type LoopMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string }

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List every file currently in the local on-device workspace.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read one file from the local workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'e.g. /app.js' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite one file in the local workspace. The user sees it instantly in the Files tab and can run it in the Preview tab. Nothing is sent to GitHub.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Complete new file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete one file from the local workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pull_from_github',
      description: 'Download the configured GitHub repository branch into the local workspace (overwrites same-named local files). Use only when the user asks to load/sync the repo.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'push_to_github',
      description:
        'Commit local workspace files to the configured GitHub repository branch. Use ONLY when the user explicitly asks to push/commit/save to GitHub.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Local file paths to push; omit for all files' },
          message: { type: 'string', description: 'Commit message' },
        },
      },
    },
  },
]

function normalizeLocalPath(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('path is required')
  const path = raw.startsWith('/') ? raw : `/${raw}`
  if (path.split('/').some((part) => part === '..')) throw new Error('Relative path segments are not allowed')
  return path
}

async function refreshFiles(): Promise<void> {
  await useFsStore.getState().refresh()
}

async function executeLocalTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_files': {
      const entries = await vfs.listTree('/')
      const files = entries.filter((entry) => !entry.isDir)
      if (files.length === 0) return '(workspace is empty)'
      return files.map((entry) => entry.path).join('\n')
    }
    case 'read_file': {
      const path = normalizeLocalPath(args.path)
      if (!(await vfs.fileExists(path))) return `File not found: ${path}`
      return vfs.readFile(path)
    }
    case 'write_file': {
      const path = normalizeLocalPath(args.path)
      const content = String(args.content ?? '')
      await vfs.writeFile(path, content)
      await refreshFiles()
      return `Wrote ${path} (${content.length} chars) to the local workspace`
    }
    case 'delete_file': {
      const path = normalizeLocalPath(args.path)
      await vfs.deletePath(path)
      await refreshFiles()
      return `Deleted ${path}`
    }
    case 'pull_from_github': {
      const result = await importGitHubWorkspace(60)
      await refreshFiles()
      return `Imported ${result.importedCount}/${result.eligibleCount} files from GitHub${result.truncated ? ' (truncated)' : ''}${result.errorCount ? `, ${result.errorCount} errors` : ''}`
    }
    case 'push_to_github': {
      const requested = Array.isArray(args.paths) ? args.paths.map(normalizeLocalPath) : null
      const entries = await vfs.listTree('/')
      const all = entries.filter((entry) => !entry.isDir).map((entry) => entry.path)
      const paths = requested ?? all
      if (paths.length === 0) return 'Nothing to push: the workspace is empty'
      if (paths.length > 20) throw new Error('Push at most 20 files per call')
      const message = typeof args.message === 'string' && args.message.trim() ? args.message.trim() : undefined
      const pushed: string[] = []
      for (const path of paths) {
        const content = await vfs.readFile(path)
        const result = await commitFile({ path, content, message: message ?? `Update ${path} from mobile app` })
        pushed.push(`${path} → ${result.status}${result.commitUrl ? ` (${result.commitUrl})` : ''}`)
      }
      return `Pushed ${pushed.length} file(s) to GitHub:\n${pushed.join('\n')}`
    }
    default:
      return `Unknown tool: ${name}`
  }
}

function systemPrompt(): string {
  const { owner, repo, branch } = useSettingsStore.getState()
  const repoLine = owner && repo ? `${owner}/${repo} (branch ${branch || 'main'})` : 'not configured'
  return (
    `You are Best Code Agent, a coding assistant inside a mobile phone IDE that works like Replit. ` +
    `The user has a LOCAL on-device workspace: the Files tab shows local files, and the Preview tab can run ` +
    `HTML/JS/TS files directly on the phone. Your file tools (list_files, read_file, write_file, delete_file) ` +
    `operate on this local workspace only — writing a file makes it appear in the Files tab immediately and ` +
    `does NOT touch GitHub. The configured GitHub repository is ${repoLine}; use pull_from_github / ` +
    `push_to_github ONLY when the user explicitly asks to sync or push. ` +
    `When the user asks for a program, write the file(s) locally and tell them to open the Preview tab to run it. ` +
    `For a runnable browser demo prefer a single self-contained .html file, or a plain .js file for console output. ` +
    `Reply in the user's language (usually Mongolian). Keep replies short and concrete.`
  )
}

export async function runLocalAgent(
  history: { role: 'user' | 'assistant'; content: string }[],
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const { backendUrl, authToken } = useSettingsStore.getState()
  if (!backendUrl || !authToken) {
    onEvent({ type: 'error', message: 'Settings tab-с backend URL болон token-оо тохируулна уу.' })
    return
  }

  const messages: LoopMessage[] = [{ role: 'system', content: systemPrompt() }, ...history]

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const res = await fetch(`${backendUrl}/api/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ messages, tools: TOOL_SCHEMAS }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Backend error ${res.status}: ${text}`)
    }
    const data = (await res.json()) as { message: AssistantMessage | null }
    const assistant = data.message
    if (!assistant) throw new Error('Model returned an empty message')

    if (typeof assistant.content === 'string' && assistant.content) {
      onEvent({ type: 'text', text: assistant.content })
    }
    messages.push(assistant)

    const toolCalls = assistant.tool_calls ?? []
    if (toolCalls.length === 0) return

    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index]
      const id = toolCall.id || `call_${iteration}_${index}`
      const name = toolCall.function?.name ?? 'unknown'
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}')
      } catch {
        /* malformed args from the model — proceed with empty object */
      }

      onEvent({ type: 'tool_call', id, name, args })

      let result: string
      let isError = false
      try {
        result = await executeLocalTool(name, args)
      } catch (err) {
        result = err instanceof Error ? err.message : String(err)
        isError = true
      }

      onEvent({ type: 'tool_result', id, result: result.slice(0, 2000), error: isError })
      messages.push({ role: 'tool', tool_call_id: id, content: result.slice(0, MAX_RESULT_CHARS) })
    }
  }

  onEvent({ type: 'error', message: `Агент ${MAX_ITERATIONS} алхамд багтаж дуусаагүй тул зогслоо.` })
}
