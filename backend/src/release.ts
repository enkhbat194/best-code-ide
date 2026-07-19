import * as gh from './github'
import { getProject } from './projects'
import type { Env } from './types'
import { jsonError, jsonResponse } from './utils'

export const BACKEND_BUILD = 'master-v2-integrity-v1'
export const PRODUCTION_BRANCH = 'main'

export type ReleaseIntegrityStatus = 'verified_main' | 'stale_main' | 'preview_build' | 'unverified'

export interface ReleaseIntegrityAssessment {
  status: ReleaseIntegrityStatus
  production_ready: boolean
  reason: string
}

function normalizeBranch(value: string | null | undefined): string | null {
  const branch = value?.trim().replace(/^refs\/heads\//, '')
  if (!branch || branch.length > 160 || !/^[A-Za-z0-9._/-]+$/.test(branch)) return null
  return branch
}

function normalizeSha(value: string | null | undefined): string | null {
  const sha = value?.trim().toLowerCase()
  if (!sha || !/^[a-f0-9]{7,64}$/.test(sha)) return null
  return sha
}

export function assessReleaseIntegrity(input: {
  clientBranch: string | null | undefined
  clientSha: string | null | undefined
  defaultBranch: string
  mainSha: string
}): ReleaseIntegrityAssessment {
  const clientBranch = normalizeBranch(input.clientBranch)
  const clientSha = normalizeSha(input.clientSha)
  const defaultBranch = normalizeBranch(input.defaultBranch)
  const mainSha = normalizeSha(input.mainSha)

  if (!clientBranch || !clientSha || !defaultBranch || !mainSha) {
    return {
      status: 'unverified',
      production_ready: false,
      reason: 'Build branch/SHA metadata дутуу тул энэ PWA яг ямар source-оос гарсныг батлах боломжгүй.',
    }
  }

  if (clientBranch !== defaultBranch) {
    return {
      status: 'preview_build',
      production_ready: false,
      reason: `Энэ PWA ${clientBranch} branch-ээс build хийгдсэн; зөвхөн ${defaultBranch} production source байж болно.`,
    }
  }

  if (clientSha !== mainSha) {
    return {
      status: 'stale_main',
      production_ready: false,
      reason: `PWA source ${clientSha.slice(0, 8)} боловч GitHub ${defaultBranch} одоо ${mainSha.slice(0, 8)} байна.`,
    }
  }

  return {
    status: 'verified_main',
    production_ready: true,
    reason: `PWA branch ба SHA нь GitHub ${defaultBranch}-ийн одоогийн source-той таарч байна.`,
  }
}

export function healthPayload(env: Env): Record<string, unknown> {
  return {
    ok: true,
    build: BACKEND_BUILD,
    worker_version: env.CF_VERSION_METADATA
      ? {
          id: env.CF_VERSION_METADATA.id,
          tag: env.CF_VERSION_METADATA.tag ?? null,
          created_at: env.CF_VERSION_METADATA.timestamp,
        }
      : null,
  }
}

export async function handleRelease(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/release' || req.method !== 'GET') return null

  try {
    const projectId = url.searchParams.get('project_id')?.trim()
    if (!projectId) return jsonError('project_id is required', 400)

    const project = getProject(env, projectId)
    const mainBranch = await gh.getBranch(env.GITHUB_TOKEN, project.owner, project.repo, PRODUCTION_BRANCH)
    if (!mainBranch) return jsonError(`Production branch not found: ${PRODUCTION_BRANCH}`, 404)

    const clientBranch = url.searchParams.get('client_branch')
    const clientSha = url.searchParams.get('client_sha')
    const assessment = project.defaultBranch === PRODUCTION_BRANCH
      ? assessReleaseIntegrity({
          clientBranch,
          clientSha,
          defaultBranch: PRODUCTION_BRANCH,
          mainSha: mainBranch.sha,
        })
      : {
          status: 'unverified' as const,
          production_ready: false,
          reason: `Project registry ${project.defaultBranch} branch-ийг default гэж тохируулсан; BC-R23 зөвхөн ${PRODUCTION_BRANCH}-ийг production source болгоно.`,
        }

    const response = jsonResponse({
      ok: true,
      checked_at: new Date().toISOString(),
      policy: {
        master_version: '2.0.0',
        rule: 'BC-R23',
        production_branch: PRODUCTION_BRANCH,
      },
      integrity: assessment,
      client: {
        branch: normalizeBranch(clientBranch),
        sha: normalizeSha(clientSha),
        build_id: url.searchParams.get('client_build_id')?.trim().slice(0, 160) || null,
        environment: url.searchParams.get('client_environment')?.trim().slice(0, 80) || null,
      },
      repository: {
        full_name: `${project.owner}/${project.repo}`,
        default_branch: PRODUCTION_BRANCH,
        configured_branch: project.defaultBranch,
        main_sha: mainBranch.sha,
      },
      backend: {
        build: BACKEND_BUILD,
        version_id: env.CF_VERSION_METADATA?.id ?? null,
        version_tag: env.CF_VERSION_METADATA?.tag ?? null,
        created_at: env.CF_VERSION_METADATA?.timestamp ?? null,
      },
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 502)
  }
}
