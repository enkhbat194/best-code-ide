import * as gh from './github'
import { createApproval } from './approvalClient'
import type { ApprovalOperation } from './approvalStore'
import { createUnifiedDiff } from './patch'
import { listProjects } from './projects'
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

function isProtectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master'
}

function normalizePath(value: string): string {
  const path = value.trim().replace(/^\/+/, '')
  if (!path || path.length > 240) throw new Error('Invalid file path')
  if (path.split('/').some((part) => part === '..' || part === '.')) throw new Error('Relative path segments are not allowed')
  return path
}

function riskReasons(path: string): string[] {
  const reasons: string[] = []
  if (path.startsWith('.github/workflows/')) reasons.push('workflow_change')
  if (/(^|\/)(\.env|wrangler\.toml|package\.json|package-lock\.json)$/i.test(path)) {
    reasons.push('configuration_or_dependency_change')
  }
  return reasons
}

export async function handleFilesCommit(req: Request, env: Env): Promise<Response> {
  let body: CommitRequestBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body')
  }

  const owner = body.owner?.trim()
  const repo = body.repo?.trim()
  const branch = body.branch?.trim() || 'main'
  if (!owner || !repo || !body.path) return jsonError('owner, repo, and path are required')
  if (typeof body.content !== 'string' || body.content.length > 500_000) {
    return jsonError('content must be UTF-8 text no larger than 500000 characters')
  }

  const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
  if (!githubToken) return jsonError('GITHUB_TOKEN secret is missing', 500)

  // Default flow is Replit-style: commit straight to the selected branch.
  // Set REQUIRE_APPROVALS=true to switch to the staged approval workflow below.
  const approvalsRequired = env.REQUIRE_APPROVALS?.trim().toLowerCase() === 'true'
  if (!approvalsRequired) {
    try {
      const path = normalizePath(body.path)
      const message = (body.message?.trim() || `Update ${path} from mobile app`).slice(0, 160)
      const result = await gh.putFile(githubToken, owner, repo, path, body.content, message, branch)
      return jsonResponse({ ok: true, status: 'committed', approvalRequired: false, branch, commitUrl: result.commitUrl })
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 502)
    }
  }

  if (isProtectedBranch(branch)) {
    return jsonError('Direct changes to main/master are blocked. Create and select a working branch first.', 409)
  }

  const project = listProjects(env).find((item) => item.owner === owner && item.repo === repo)
  if (!project) return jsonError('Repository is not present in the approved project registry', 403)

  try {
    const path = normalizePath(body.path)
    const existing = await gh.getFile(githubToken, owner, repo, path, branch)
    if (existing?.content === body.content) return jsonError('The proposed content is identical to the branch content', 409)

    const operationId = crypto.randomUUID()
    const now = new Date()
    const reasons = riskReasons(path)
    const operation: ApprovalOperation = {
      operation_id: operationId,
      project_id: project.id,
      repository: { owner, repo, full_name: `${owner}/${repo}` },
      branch,
      title: (body.message?.trim() || `Update ${path} from mobile workspace`).slice(0, 160),
      summary: `Review the mobile editor change proposed for ${path}.`,
      status: 'pending_approval',
      approval_required: true,
      risk: reasons.length > 0 ? 'high' : 'normal',
      risk_reasons: reasons,
      changes: [
        {
          action: existing ? 'update' : 'create',
          path,
          base_sha: existing?.sha ?? null,
          base_content: existing?.content ?? null,
          proposed_content: body.content,
          diff: createUnifiedDiff(path, existing?.content ?? null, body.content),
        },
      ],
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }

    await createApproval(env, operation)
    return jsonResponse({
      ok: true,
      status: operation.status,
      approvalRequired: true,
      operationId,
      branch,
      risk: operation.risk,
      diff: operation.changes[0].diff,
    }, 202)
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502)
  }
}
