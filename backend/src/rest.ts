import { executeTool } from './tools'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env, RepoContext } from './types'

async function toolResponse(name: string, args: Record<string, unknown>, env: Env, ctx: RepoContext): Promise<Response> {
  const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
  if (!githubToken) return jsonError('GITHUB_TOKEN secret is missing', 500)
  try {
    const result = await executeTool(name, args, githubToken, ctx)
    return jsonResponse({ result })
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502)
  }
}

/** REST surface used by ChatGPT Actions and other external AI clients. */
export async function handleRest(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/repos' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return toolResponse('create_repo', body, env, { owner: '', repo: '', branch: '' })
  }

  const match = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (!match) return null

  const owner = decodeURIComponent(match[1])
  const repo = decodeURIComponent(match[2])
  const sub = match[3] ?? ''
  const branch = url.searchParams.get('branch') || 'main'
  const ctx: RepoContext = { owner, repo, branch }

  if (sub === '/files' && req.method === 'GET') {
    return toolResponse('list_files', { path: url.searchParams.get('path') ?? '' }, env, ctx)
  }

  if (sub === '/tree' && req.method === 'GET') {
    return toolResponse('list_tree', { max_entries: Number(url.searchParams.get('max_entries') ?? '500') }, env, ctx)
  }

  if (sub === '/search' && req.method === 'GET') {
    return toolResponse(
      'search_code',
      { query: url.searchParams.get('query') ?? '', limit: Number(url.searchParams.get('limit') ?? '20') },
      env,
      ctx,
    )
  }

  if (sub === '/file' && req.method === 'GET') {
    return toolResponse('read_file', { path: url.searchParams.get('path') ?? '' }, env, ctx)
  }

  if (sub === '/files/read' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { paths?: string[] }
    return toolResponse('read_files', { paths: body.paths ?? [] }, env, ctx)
  }

  if (sub === '/file' && req.method === 'PUT') {
    const body = (await req.json().catch(() => ({}))) as { path?: string; content?: string; message?: string }
    if (!body.path) return jsonError('path is required in body')
    return toolResponse('write_file', body, env, ctx)
  }

  if (sub === '/file' && req.method === 'DELETE') {
    const path = url.searchParams.get('path') ?? ''
    const message = url.searchParams.get('message') ?? undefined
    return toolResponse('delete_file', { path, message }, env, ctx)
  }

  if (sub === '/branches' && req.method === 'GET') {
    return toolResponse('list_branches', { limit: Number(url.searchParams.get('limit') ?? '30') }, env, ctx)
  }

  if (sub === '/branches' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { name?: string; from?: string }
    return toolResponse('create_branch', body, env, ctx)
  }

  if (sub === '/compare' && req.method === 'GET') {
    return toolResponse(
      'compare_branches',
      { base: url.searchParams.get('base') ?? '', head: url.searchParams.get('head') ?? '' },
      env,
      ctx,
    )
  }

  if (sub === '/commits' && req.method === 'GET') {
    const path = url.searchParams.get('path') ?? undefined
    const limit = Number(url.searchParams.get('limit') ?? '10')
    return toolResponse('list_commits', { path, limit }, env, ctx)
  }

  if (sub === '/validation' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { branch?: string }
    return toolResponse('run_validation', body, env, ctx)
  }

  if (sub === '/validation' && req.method === 'GET') {
    return toolResponse('validation_status', { branch: url.searchParams.get('branch') ?? branch }, env, ctx)
  }

  return null
}
