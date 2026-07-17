import * as gh from './github'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'html', 'css', 'scss', 'sass', 'less',
  'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'svg', 'py', 'go', 'rs', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'sql', 'graphql',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
])

const TEXT_FILENAMES = new Set([
  'Dockerfile', 'Makefile', 'Procfile', 'LICENSE', 'README', '.gitignore', '.dockerignore', '.editorconfig',
])

interface WorkspaceExportRequest {
  owner: string
  repo: string
  branch?: string
  maxFiles?: number
}

function isTextPath(path: string): boolean {
  const name = path.split('/').pop() ?? path
  if (TEXT_FILENAMES.has(name)) return true
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  return TEXT_EXTENSIONS.has(extension)
}

export async function handleWorkspaceExport(req: Request, env: Env): Promise<Response> {
  let body: WorkspaceExportRequest
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body')
  }

  const owner = body.owner?.trim()
  const repo = body.repo?.trim()
  const branch = body.branch?.trim() || 'main'
  if (!owner || !repo) return jsonError('owner and repo are required')

  const token = resolveSecret(env, 'GITHUB_TOKEN')
  if (!token) return jsonError('GITHUB_TOKEN secret is missing', 500)

  const maxFiles = Math.min(Math.max(Math.floor(body.maxFiles ?? 40), 1), 40)

  try {
    const tree = await gh.getTree(token, owner, repo, branch)
    const candidates = tree.filter(
      (entry) => entry.type === 'blob' && isTextPath(entry.path) && (entry.size ?? 0) <= 250_000,
    )
    const selected = candidates.slice(0, maxFiles)
    const files: { path: string; content: string }[] = []
    const errors: { path: string; error: string }[] = []

    for (let index = 0; index < selected.length; index += 8) {
      const batch = selected.slice(index, index + 8)
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            const file = await gh.getFile(token, owner, repo, entry.path, branch)
            return file ? { path: entry.path, content: file.content } : { path: entry.path, error: 'File not found' }
          } catch (err) {
            return { path: entry.path, error: err instanceof Error ? err.message : String(err) }
          }
        }),
      )
      for (const result of results) {
        if ('content' in result) files.push({ path: result.path, content: result.content })
        else errors.push({ path: result.path, error: result.error })
      }
    }

    return jsonResponse({
      owner,
      repo,
      branch,
      files,
      errors,
      importedCount: files.length,
      eligibleCount: candidates.length,
      truncated: candidates.length > selected.length,
      maxFiles,
    })
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502)
  }
}
