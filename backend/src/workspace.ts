import * as gh from './github'
import { getRepositoryTree, listAccessibleRepositories, type RepositoryTreeEntry } from './githubRepositoryBrowser'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'html', 'css', 'scss', 'sass', 'less',
  'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'svg', 'py', 'go', 'rs', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'sql', 'graphql',
  'env', 'gitignore', 'dockerignore', 'editorconfig', 'lock',
])

const TEXT_FILENAMES = new Set([
  'Dockerfile', 'Makefile', 'Procfile', 'LICENSE', 'README', '.gitignore', '.dockerignore', '.editorconfig',
])

interface WorkspaceExportRequest {
  action?: 'list' | 'export'
  owner?: string
  repo?: string
  branch?: string
  maxFiles?: number
}

function isTextPath(path: string): boolean {
  const name = path.split('/').pop() ?? path
  if (TEXT_FILENAMES.has(name)) return true
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  return TEXT_EXTENSIONS.has(extension)
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function previewRootCandidate(path: string): { root: string; score: number } | null {
  const normalized = path.replace(/^\/+/, '')
  const lower = normalized.toLowerCase()
  let root = ''
  let score = 0

  if (lower === 'index.html' || lower.endsWith('/index.html')) {
    root = dirname(normalized)
    score = 100
  } else if (/\/(src\/)?main\.(tsx|jsx|ts|js)$/.test(`/${lower}`)) {
    const marker = lower.lastIndexOf('/src/main.')
    root = marker >= 0 ? normalized.slice(0, marker) : dirname(normalized)
    score = 80
  } else if (/\/(src\/)?app\.(tsx|jsx|ts|js)$/.test(`/${lower}`)) {
    const marker = lower.lastIndexOf('/src/app.')
    root = marker >= 0 ? normalized.slice(0, marker) : dirname(normalized)
    score = 60
  } else {
    return null
  }

  const segments = root.toLowerCase().split('/').filter(Boolean)
  if (segments.some((segment) => ['frontend', 'client', 'web', 'app', 'site'].includes(segment))) score += 40
  if (segments.some((segment) => ['backend', 'server', 'api', 'functions'].includes(segment))) score -= 60
  score -= segments.length
  return { root, score }
}

function detectPreviewRoot(tree: RepositoryTreeEntry[]): string {
  const candidates = tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => previewRootCandidate(entry.path))
    .filter((entry): entry is { root: string; score: number } => Boolean(entry))
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.root ?? ''
}

function relativeToRoot(path: string, root: string): string {
  if (!root) return path
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export async function handleWorkspaceExport(req: Request, env: Env): Promise<Response> {
  let body: WorkspaceExportRequest
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body')
  }

  const token = resolveSecret(env, 'GITHUB_TOKEN')
  if (!token) return jsonError('GITHUB_TOKEN secret is missing', 500)

  if (body.action === 'list') {
    try {
      const repositories = await listAccessibleRepositories(token)
      return jsonResponse({ repositories })
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 502)
    }
  }

  const owner = body.owner?.trim()
  const repo = body.repo?.trim()
  const branch = body.branch?.trim() || 'main'
  if (!owner || !repo) return jsonError('owner and repo are required')

  const maxFiles = Math.min(Math.max(Math.floor(body.maxFiles ?? 300), 1), 400)

  try {
    const tree = await getRepositoryTree(token, owner, repo, branch)
    const projectRoot = detectPreviewRoot(tree)
    const candidates = tree.filter(
      (entry) =>
        entry.type === 'blob' &&
        isTextPath(entry.path) &&
        (entry.size ?? 0) <= 250_000 &&
        (!projectRoot || entry.path.startsWith(`${projectRoot}/`)),
    )
    const selected = candidates.slice(0, maxFiles)
    const files: { path: string; sourcePath: string; content: string }[] = []
    const errors: { path: string; error: string }[] = []

    for (let index = 0; index < selected.length; index += 8) {
      const batch = selected.slice(index, index + 8)
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            const file = await gh.getFile(token, owner, repo, entry.path, branch)
            return file
              ? { path: relativeToRoot(entry.path, projectRoot), sourcePath: entry.path, content: file.content }
              : { path: entry.path, error: 'File not found' }
          } catch (err) {
            return { path: entry.path, error: err instanceof Error ? err.message : String(err) }
          }
        }),
      )
      for (const result of results) {
        if ('content' in result && typeof result.content === 'string') {
          files.push({ path: result.path, sourcePath: result.sourcePath, content: result.content })
        } else {
          errors.push({ path: result.path, error: 'error' in result ? result.error : 'File not found' })
        }
      }
    }

    return jsonResponse({
      owner,
      repo,
      branch,
      projectRoot,
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
