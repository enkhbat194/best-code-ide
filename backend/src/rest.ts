import { executeTool } from './tools'
import { jsonError, jsonResponse } from './utils'
import type { Env, RepoContext } from './types'

async function toolResponse(name: string, args: Record<string, unknown>, env: Env, ctx: RepoContext): Promise<Response> {
  try {
    const result = await executeTool(name, args, env.GITHUB_TOKEN, ctx)
    return jsonResponse({ result })
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502)
  }
}

/** REST surface mirroring the same tools, for AI chats that call HTTP actions (e.g. ChatGPT Custom GPT Actions). */
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

  if (sub === '/file' && req.method === 'GET') {
    return toolResponse('read_file', { path: url.searchParams.get('path') ?? '' }, env, ctx)
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

  if (sub === '/commits' && req.method === 'GET') {
    const path = url.searchParams.get('path') ?? undefined
    const limit = Number(url.searchParams.get('limit') ?? '10')
    return toolResponse('list_commits', { path, limit }, env, ctx)
  }

  return null
}
