import { listApprovals, markSuperseded } from './approvalClient'
import * as gh from './github'
import { getProject } from './projects'
import type { Env } from './types'
import { jsonError, jsonResponse, resolveSecret } from './utils'

const TERMINAL = new Set([
  'rejected', 'cancelled', 'expired', 'superseded', 'commit_prepared',
  'pushed', 'pull_request_opened', 'completed',
])

function cleanSha(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const sha = value.trim().toLowerCase()
  return /^[a-f0-9]{7,40}$/.test(sha) ? sha : undefined
}

function deletableBranch(name: string, defaultBranch: string): boolean {
  return name.startsWith('agent/') && name !== defaultBranch && name !== 'main' && name !== 'master'
}

async function buildPlan(env: Env, projectId: string) {
  const project = getProject(env, projectId)
  const token = resolveSecret(env, 'GITHUB_TOKEN')
  if (!token) throw new Error('GITHUB_TOKEN is not configured')

  const main = await gh.getBranch(token, project.owner, project.repo, project.defaultBranch)
  if (!main) throw new Error(`Default branch not found: ${project.defaultBranch}`)

  const branchCache = new Map<string, gh.BranchInfo | null>([[project.defaultBranch, main]])
  const currentBranch = async (branch: string): Promise<gh.BranchInfo | null> => {
    if (branchCache.has(branch)) return branchCache.get(branch) ?? null
    const value = await gh.getBranch(token, project.owner, project.repo, branch)
    branchCache.set(branch, value)
    return value
  }

  const approvals = await listApprovals(env, { projectId, limit: 100 })
  const staleApprovals = []
  for (const operation of approvals.items) {
    if (TERMINAL.has(operation.status) || !operation.base_context_sha) continue
    const branchName = operation.branch || project.defaultBranch
    const branch = await currentBranch(branchName)
    if (!branch || branch.sha !== operation.base_context_sha) {
      staleApprovals.push({
        operation_id: operation.operation_id,
        title: operation.title,
        status: operation.status,
        branch: branchName,
        base_context_sha: operation.base_context_sha,
        current_context_sha: branch?.sha,
        stale_reason: branch
          ? `branch ${branchName} changed from ${operation.base_context_sha} to ${branch.sha}`
          : `branch ${branchName} no longer exists`,
      })
    }
  }

  const branches = await gh.listBranches(token, project.owner, project.repo, 100)
  const mergedBranches = []
  for (const branch of branches) {
    if (branch.protected || !deletableBranch(branch.name, project.defaultBranch)) continue
    const comparison = await gh.compareBranchDetails(
      token,
      project.owner,
      project.repo,
      project.defaultBranch,
      branch.name,
    )
    if (comparison.ahead_by === 0 && ['behind', 'identical'].includes(comparison.status)) {
      mergedBranches.push({ name: branch.name, sha: branch.sha, comparison: comparison.status })
    }
  }

  return {
    checked_at: new Date().toISOString(),
    project: { id: project.id, repository: `${project.owner}/${project.repo}`, default_branch: project.defaultBranch },
    current_main_sha: main.sha,
    stale_approvals: staleApprovals,
    merged_branches: mergedBranches,
    counts: { stale_approvals: staleApprovals.length, merged_branches: mergedBranches.length },
  }
}

export async function handleMaintenance(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/maintenance')) return null
  const projectId = url.searchParams.get('project_id')?.trim() || 'bestcode'

  try {
    if (url.pathname === '/api/maintenance' && req.method === 'GET') {
      return jsonResponse(await buildPlan(env, projectId))
    }

    if (url.pathname === '/api/maintenance/approvals/supersede' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { confirmation?: string; expected_main_sha?: string } | null
      if (body?.confirmation !== 'SUPERSEDE_STALE_APPROVALS') {
        return jsonError('Exact confirmation SUPERSEDE_STALE_APPROVALS is required', 409)
      }
      const plan = await buildPlan(env, projectId)
      const expected = cleanSha(body.expected_main_sha)
      if (!expected || !plan.current_main_sha.startsWith(expected)) {
        return jsonError('Maintenance plan is stale because main SHA changed', 409)
      }
      const items = []
      for (const operation of plan.stale_approvals) {
        items.push(await markSuperseded(
          env,
          operation.operation_id,
          `MAINTENANCE_CONTEXT_STALE: ${operation.stale_reason}`,
        ))
      }
      return jsonResponse({ ok: true, updated: items.length, operation_ids: items.map((item) => item.operation_id) })
    }

    if (url.pathname === '/api/maintenance/branches/delete' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as {
        confirmation?: string
        expected_main_sha?: string
        branches?: { name?: string; sha?: string }[]
      } | null
      if (body?.confirmation !== 'DELETE_MERGED_BRANCHES') {
        return jsonError('Exact confirmation DELETE_MERGED_BRANCHES is required', 409)
      }
      const plan = await buildPlan(env, projectId)
      const expected = cleanSha(body.expected_main_sha)
      if (!expected || !plan.current_main_sha.startsWith(expected)) {
        return jsonError('Maintenance plan is stale because main SHA changed', 409)
      }
      const requested = new Map((body.branches ?? []).map((item) => [item.name, item.sha]))
      const allowed = plan.merged_branches.filter((branch) => requested.get(branch.name) === branch.sha)
      if (allowed.length !== requested.size) {
        return jsonError('One or more branch names or SHAs no longer match the verified maintenance plan', 409)
      }
      const project = getProject(env, projectId)
      const token = resolveSecret(env, 'GITHUB_TOKEN')
      if (!token) throw new Error('GITHUB_TOKEN is not configured')
      const deleted = []
      for (const branch of allowed) {
        const current = await gh.getBranch(token, project.owner, project.repo, branch.name)
        if (!current || current.protected || current.sha !== branch.sha) {
          return jsonError(`Branch changed during maintenance: ${branch.name}`, 409)
        }
        await gh.deleteBranch(token, project.owner, project.repo, branch.name)
        deleted.push(branch.name)
      }
      return jsonResponse({ ok: true, deleted: deleted.length, branches: deleted })
    }

    return jsonError('Method not allowed', 405)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 502)
  }
}
