import * as gh from './github'
import { jsonError, jsonResponse, resolveSecret } from './utils'
import type { Env } from './types'

interface CommitRequestBody {
  owner: string
  repo: string
  branch?: string
  path: string
  content: string
  message?: string
}

export async function handleFilesCommit(req: Request, env: Env): Promise<Response> {
  let body: CommitRequestBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body')
  }

  const { owner, repo, path, content } = body
  const branch = body.branch || 'main'
  const message = body.message || `Update ${path}`
  if (!owner || !repo || !path) return jsonError('owner, repo, and path are required')

  const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
  if (!githubToken) return jsonError('GITHUB_TOKEN secret is missing', 500)

  try {
    const result = await gh.putFile(githubToken, owner, repo, path, content ?? '', message, branch)
    return jsonResponse({ ok: true, commitUrl: result.commitUrl })
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502)
  }
}
