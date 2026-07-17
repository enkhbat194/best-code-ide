import * as gh from './github'
import { getProject, listProjects, type ProjectConfig } from './projects'
import type { Env } from './types'

const GITHUB_API = 'https://api.github.com'
const MAX_FILE_OUTPUT_CHARS = 50_000

const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    operation_id: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'failed'] },
    project_id: { type: 'string' },
    repository: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        full_name: { type: 'string' },
      },
    },
    branch: { type: 'string' },
    result: { type: 'object' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
        action_required: { type: 'string' },
      },
    },
  },
  required: ['ok', 'operation_id', 'status'],
} as const

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

export const readOnlyMcpTools = [
  {
    name: 'projects_list',
    title: 'List BestCode projects',
    description: 'List only the projects explicitly allowed by the BestCode project registry.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'Opaque cursor returned by a previous call.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'project_get',
    title: 'Get project',
    description: 'Get one allowed project, its GitHub repository metadata, default branch, and current availability.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'repository_tree',
    title: 'Read repository tree',
    description: 'Read a paginated recursive folder and file tree from an allowed project branch.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        cursor: { type: 'string', description: 'Opaque cursor returned by a previous call.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'repository_read_file',
    title: 'Read repository file',
    description: 'Read a bounded line range from one UTF-8 repository file. The result includes a cursor when more lines remain.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        path: { type: 'string' },
        cursor: { type: 'string', description: 'Opaque line cursor returned by a previous call.' },
        line_limit: { type: 'integer', minimum: 1, maximum: 400, default: 200 },
      },
      required: ['project_id', 'path'],
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'repository_read_files',
    title: 'Read multiple repository files',
    description: 'Read up to 12 related UTF-8 files from one allowed project branch with bounded output per file.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
        paths: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
        max_chars_per_file: { type: 'integer', minimum: 500, maximum: 20_000, default: 12_000 },
      },
      required: ['project_id', 'paths'],
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'repository_search_code',
    title: 'Search repository code',
    description: 'Search GitHub code by text, symbol, filename, or error text. GitHub code search uses the repository indexed default branch.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['project_id', 'query'],
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'repository_get_branch',
    title: 'Get repository branch',
    description: 'Get the selected branch SHA and protection status for an allowed project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        branch: { type: 'string' },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
] as const

interface ToolErrorBody {
  code: string
  message: string
  retryable: boolean
  action_required?: string
}

interface ToolEnvelope {
  ok: boolean
  operation_id: string
  status: 'completed' | 'failed'
  project_id?: string
  repository?: { owner: string; repo: string; full_name: string }
  branch?: string
  result?: Record<string, unknown>
  error?: ToolErrorBody
}

export interface McpCallToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: ToolEnvelope
  isError?: boolean
}

function encodeCursor(offset: number): string {
  return btoa(String(offset)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeCursor(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const offset = Number(atob(normalized))
    return Number.isInteger(offset) && offset >= 0 ? offset : 0
  } catch {
    throw new Error('Invalid cursor')
  }
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function repository(project: ProjectConfig) {
  return { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` }
}

function classifyError(error: unknown): ToolErrorBody {
  const message = error instanceof Error ? error.message : String(error)
  if (/Project not found or not permitted/i.test(message)) {
    return { code: 'PROJECT_NOT_FOUND', message, retryable: false, action_required: 'Choose a project returned by projects_list.' }
  }
  if (/Invalid cursor|required|must be|accepts at most/i.test(message)) {
    return { code: 'INVALID_ARGUMENT', message, retryable: false, action_required: 'Correct the tool arguments and retry.' }
  }
  if (/404|not found/i.test(message)) {
    return { code: 'GITHUB_NOT_FOUND', message, retryable: false, action_required: 'Verify the path, branch, and project access.' }
  }
  if (/401|Bad credentials/i.test(message)) {
    return { code: 'GITHUB_UNAUTHORIZED', message, retryable: false, action_required: 'Replace or reauthorize the GitHub token stored in Cloudflare Secrets.' }
  }
  if (/403|rate limit/i.test(message)) {
    return { code: 'GITHUB_FORBIDDEN_OR_RATE_LIMITED', message, retryable: true, action_required: 'Check GitHub token permissions and rate limits.' }
  }
  if (/5\d\d/.test(message)) {
    return { code: 'UPSTREAM_UNAVAILABLE', message, retryable: true, action_required: 'Retry after a short delay.' }
  }
  return { code: 'TOOL_EXECUTION_FAILED', message, retryable: false, action_required: 'Inspect the returned error and BestCode Worker logs.' }
}

function finish(envelope: ToolEnvelope): McpCallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    ...(envelope.ok ? {} : { isError: true }),
  }
}

async function githubJson<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'best-code-ide-worker',
    },
  })
  if (!response.ok) throw new Error(`GitHub error ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

function resolveProject(args: Record<string, unknown>, env: Env): ProjectConfig {
  return getProject(env, requireString(args, 'project_id'))
}

function resolveBranch(args: Record<string, unknown>, project: ProjectConfig): string {
  return typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : project.defaultBranch
}

export async function executeReadOnlyMcpTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
): Promise<McpCallToolResult> {
  const operationId = crypto.randomUUID()
  let project: ProjectConfig | undefined
  let branch: string | undefined

  try {
    if (name === 'projects_list') {
      const projects = listProjects(env)
      const offset = decodeCursor(args.cursor)
      const limit = boundedInteger(args.limit, 20, 1, 50)
      const items = projects.slice(offset, offset + limit).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? '',
        repository: `${item.owner}/${item.repo}`,
        default_branch: item.defaultBranch,
      }))
      const nextOffset = offset + items.length
      return finish({
        ok: true,
        operation_id: operationId,
        status: 'completed',
        result: {
          items,
          count: items.length,
          total: projects.length,
          next_cursor: nextOffset < projects.length ? encodeCursor(nextOffset) : null,
        },
      })
    }

    project = resolveProject(args, env)
    branch = resolveBranch(args, project)
    const projectFields = { project_id: project.id, repository: repository(project), branch }

    switch (name) {
      case 'project_get': {
        const repoInfo = await githubJson<{
          full_name: string
          default_branch: string
          private: boolean
          archived: boolean
          html_url: string
          updated_at: string
        }>(token, `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}`)
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...projectFields,
          result: {
            id: project.id,
            name: project.name,
            description: project.description ?? '',
            default_branch: repoInfo.default_branch,
            private: repoInfo.private,
            archived: repoInfo.archived,
            url: repoInfo.html_url,
            updated_at: repoInfo.updated_at,
            available: true,
          },
        })
      }

      case 'repository_tree': {
        const entries = await gh.getTree(token, project.owner, project.repo, branch)
        const offset = decodeCursor(args.cursor)
        const limit = boundedInteger(args.limit, 200, 1, 500)
        const items = entries.slice(offset, offset + limit)
        const nextOffset = offset + items.length
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...projectFields,
          result: {
            items,
            count: items.length,
            total: entries.length,
            next_cursor: nextOffset < entries.length ? encodeCursor(nextOffset) : null,
          },
        })
      }

      case 'repository_read_file': {
        const path = requireString(args, 'path').replace(/^\/+/, '')
        const file = await gh.getFile(token, project.owner, project.repo, path, branch)
        if (!file) throw new Error(`File not found: ${path}`)

        const lines = file.content.split('\n')
        const startIndex = decodeCursor(args.cursor)
        const lineLimit = boundedInteger(args.line_limit, 200, 1, 400)
        const selected: string[] = []
        let outputChars = 0
        let index = startIndex
        while (index < lines.length && selected.length < lineLimit) {
          const line = lines[index]
          const added = line.length + (selected.length > 0 ? 1 : 0)
          if (selected.length > 0 && outputChars + added > MAX_FILE_OUTPUT_CHARS) break
          selected.push(line)
          outputChars += added
          index += 1
        }

        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...projectFields,
          result: {
            path,
            sha: file.sha,
            content: selected.join('\n'),
            start_line: startIndex + 1,
            end_line: index,
            total_lines: lines.length,
            truncated: index < lines.length,
            next_cursor: index < lines.length ? encodeCursor(index) : null,
          },
        })
      }

      case 'repository_read_files': {
        const rawPaths = args.paths
        if (!Array.isArray(rawPaths)) throw new Error('paths is required')
        const paths = [...new Set(rawPaths.filter((item): item is string => typeof item === 'string').map((item) => item.trim().replace(/^\/+/, '')).filter(Boolean))]
        if (paths.length === 0) throw new Error('At least one path is required')
        if (paths.length > 12) throw new Error('repository_read_files accepts at most 12 files')
        const maxChars = boundedInteger(args.max_chars_per_file, 12_000, 500, 20_000)
        const files = await Promise.all(
          paths.map(async (path) => {
            try {
              const file = await gh.getFile(token, project!.owner, project!.repo, path, branch!)
              if (!file) return { path, ok: false, error: 'File not found' }
              return {
                path,
                ok: true,
                sha: file.sha,
                content: file.content.slice(0, maxChars),
                truncated: file.content.length > maxChars,
                total_chars: file.content.length,
              }
            } catch (error) {
              return { path, ok: false, error: error instanceof Error ? error.message : String(error) }
            }
          }),
        )
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...projectFields,
          result: { files, count: files.length },
        })
      }

      case 'repository_search_code': {
        const query = requireString(args, 'query')
        const limit = boundedInteger(args.limit, 20, 1, 50)
        const results = await gh.searchCode(token, project.owner, project.repo, query, limit)
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...projectFields,
          result: {
            query,
            search_scope: 'github_indexed_default_branch',
            items: results.map((item) => ({
              path: item.path,
              url: item.url,
              fragments: item.fragments.map((fragment) => fragment.slice(0, 2_000)),
            })),
            count: results.length,
          },
        })
      }

      case 'repository_get_branch': {
        const encodedBranch = branch.split('/').map(encodeURIComponent).join('/')
        const info = await githubJson<{ name: string; protected: boolean; commit: { sha: string } }>(
          token,
          `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/branches/${encodedBranch}`,
        )
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...projectFields,
          result: { name: info.name, sha: info.commit.sha, protected: info.protected },
        })
      }

      default:
        throw new Error(`Unknown read-only MCP tool: ${name}`)
    }
  } catch (error) {
    const classified = classifyError(error)
    return finish({
      ok: false,
      operation_id: operationId,
      status: 'failed',
      ...(project ? { project_id: project.id, repository: repository(project) } : {}),
      ...(branch ? { branch } : {}),
      error: classified,
    })
  }
}
