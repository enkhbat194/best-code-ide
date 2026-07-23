import { executeDeploymentMcpTool } from './mcpDeploymentTools'
import { executeReadOnlyMcpTool } from './mcpReadTools'
import { executeSafeWriteMcpTool } from './mcpWriteTools'
import { executeMissionMcpTool } from './missionTools'
import { executeProjectBrainMcpTool } from './projectBrainTools'
import { getProject, type ProjectConfig } from './projects'
import type { Env } from './types'

const GITHUB_API = 'https://api.github.com'

const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    operation_id: { type: 'string' },
    status: { type: 'string' },
    request_id: { type: 'string' },
    project_id: { type: 'string' },
    repository: { type: 'object' },
    branch: { type: 'string' },
    result: { type: 'object' },
    error: { type: 'object' },
  },
  required: ['ok', 'operation_id', 'status'],
} as const

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

const projectIdSchema = { type: 'string', minLength: 1, maxLength: 64 } as const
const missionIdSchema = { type: 'string', pattern: '^[a-fA-F0-9-]{16,64}$' } as const

export const subscriptionMcpTools = [
  {
    name: 'projects_list',
    title: 'List scoped BestCode projects',
    description: 'List the single project bound to this authenticated subscription-agent gateway URL.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'project_get',
    title: 'Get scoped project',
    description: 'Read repository metadata for the project bound to this subscription-agent gateway.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectIdSchema },
      required: ['project_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'brain_search',
    title: 'Search Project Brain',
    description: 'Search configured canonical Project Brain documents and return bounded line-numbered evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        query: { type: 'string', minLength: 1, maxLength: 1000 },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 12 },
        context_lines: { type: 'integer', minimum: 0, maximum: 4, default: 1 },
      },
      required: ['project_id', 'query'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'brain_export_summary',
    title: 'Export shared project context',
    description: 'Build one provider-neutral context summary from Project Brain, Mission, repository, approvals, and CI evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        max_chars_per_document: { type: 'integer', minimum: 1000, maximum: 20000, default: 8000 },
        max_total_document_chars: { type: 'integer', minimum: 5000, maximum: 60000, default: 30000 },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'mission_get',
    title: 'Get scoped Mission',
    description: 'Read one Mission only when its project matches the gateway project scope.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectIdSchema, mission_id: missionIdSchema },
      required: ['project_id', 'mission_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'mission_context_get',
    title: 'Get Mission context',
    description: 'Return the provider-neutral Mission context packet after enforcing project scope.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectIdSchema, mission_id: missionIdSchema },
      required: ['project_id', 'mission_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'repository_status',
    title: 'Read repository operation status',
    description: 'List recent staged repository operations and approval states without changing them.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        status: { type: 'string', maxLength: 60 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'repository_read_file',
    title: 'Read repository file',
    description: 'Read a bounded UTF-8 file range after strict repository-path validation.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        branch: { type: 'string', maxLength: 160 },
        path: { type: 'string', minLength: 1, maxLength: 240 },
        cursor: { type: 'string', maxLength: 100 },
        line_limit: { type: 'integer', minimum: 1, maximum: 400, default: 200 },
      },
      required: ['project_id', 'path'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'repository_search',
    title: 'Search repository',
    description: 'Search indexed repository code by text, symbol, filename, or error text.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        query: { type: 'string', minLength: 1, maxLength: 1000 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['project_id', 'query'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'pull_request_status',
    title: 'Read pull request status',
    description: 'Read a pull request by number or list pull requests associated with one branch.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        number: { type: 'integer', minimum: 1 },
        branch: { type: 'string', maxLength: 160 },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'all' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'deployment_status',
    title: 'Read deployment status',
    description: 'Read a deployment workflow task or deployment approval operation without starting a deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        task_id: { type: 'string', maxLength: 100 },
        approval_operation_id: { type: 'string', maxLength: 100 },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'handoff_packet_build',
    title: 'Build cross-agent handoff packet',
    description: 'Build a deterministic provider-neutral handoff packet grounded in the scoped repository and optional Mission.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdSchema,
        mission_id: missionIdSchema,
        branch: { type: 'string', maxLength: 160 },
        objective: { type: 'string', minLength: 1, maxLength: 4000 },
        completed_work: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
        changed_files: {
          type: 'array',
          maxItems: 300,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', minLength: 1, maxLength: 240 },
              status: { type: 'string', maxLength: 40 },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
        test_status: {
          type: 'object',
          properties: {
            state: { type: 'string', maxLength: 40 },
            summary: { type: 'string', maxLength: 2000 },
            evidence_references: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 500 } },
          },
          additionalProperties: false,
        },
        unresolved_issues: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
        decisions_required: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
        safety_constraints: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
        next_exact_action: { type: 'string', minLength: 1, maxLength: 2000 },
        source_references: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 500 } },
        evidence_references: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 500 } },
      },
      required: ['project_id', 'objective', 'next_exact_action'],
      additionalProperties: false,
    },
    outputSchema,
    annotations: readAnnotations,
  },
] as const

export const subscriptionToolNames = subscriptionMcpTools.map((tool) => tool.name)

interface ToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown>
  isError?: boolean
}

interface HandoffChangedFile {
  path: string
  status: string
}

interface HandoffPacketInput {
  project_id: string
  mission_id: string | null
  repository: string
  base_sha: string
  branch: string
  objective: string
  completed_work: string[]
  changed_files: HandoffChangedFile[]
  test_status: {
    state: string
    summary: string
    evidence_references: string[]
  }
  unresolved_issues: string[]
  decisions_required: string[]
  safety_constraints: string[]
  next_exact_action: string
  source_references: string[]
  evidence_references: string[]
}

function textResult(structuredContent: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...((structuredContent.ok === false) ? { isError: true } : {}),
  }
}

function failure(code: string, message: string, actionRequired: string, project?: ProjectConfig): ToolResult {
  return textResult({
    ok: false,
    operation_id: crypto.randomUUID(),
    status: 'failed',
    ...(project ? {
      project_id: project.id,
      repository: {
        owner: project.owner,
        repo: project.repo,
        full_name: `${project.owner}/${project.repo}`,
      },
      branch: project.defaultBranch,
    } : {}),
    error: {
      code,
      message,
      retryable: false,
      action_required: actionRequired,
    },
  })
}

function stringValue(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim().slice(0, max)
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function stringList(value: unknown, maxItems = 100, maxChars = 1000): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, maxChars))
      .filter(Boolean),
  )].sort().slice(0, maxItems)
}

export function normalizeRepositoryPath(value: string): string {
  const path = value.trim().replace(/^\/+/, '')
  if (!path || path.length > 240) throw new Error('Repository path is required and must be at most 240 characters')
  if (path.includes('\\') || path.includes('\0')) throw new Error('Repository path contains unsupported characters')
  const segments = path.split('/')
  if (segments.some((part) => part === '.' || part === '..' || !part)) throw new Error('Repository path traversal is not allowed')
  if (segments[0].toLowerCase() === '.git') throw new Error('.git paths are not accessible')
  return path
}

function changedFiles(value: unknown): HandoffChangedFile[] {
  if (!Array.isArray(value)) return []
  const byPath = new Map<string, HandoffChangedFile>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string') continue
    const path = normalizeRepositoryPath(record.path)
    byPath.set(path, {
      path,
      status: optionalString(record.status, 40) ?? 'modified',
    })
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path) || a.status.localeCompare(b.status))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  )
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

export async function buildHandoffPacket(input: HandoffPacketInput): Promise<Record<string, unknown>> {
  const packet = {
    schema_version: 'bestcode-handoff-packet-v1',
    project_id: input.project_id,
    mission_id: input.mission_id,
    repository: input.repository,
    base_sha: input.base_sha,
    branch: input.branch,
    objective: input.objective,
    completed_work: input.completed_work,
    changed_files: input.changed_files,
    test_status: input.test_status,
    unresolved_issues: input.unresolved_issues,
    decisions_required: input.decisions_required,
    safety_constraints: input.safety_constraints,
    next_exact_action: input.next_exact_action,
    source_references: input.source_references,
    evidence_references: input.evidence_references,
  }
  return {
    ...packet,
    packet_hash: await sha256(stableJson(packet)),
  }
}

function resultRecord(result: ToolResult): Record<string, unknown> {
  const value = result.structuredContent.result
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isFailed(result: ToolResult): boolean {
  return result.structuredContent.ok === false
}

function repositoryRef(project: ProjectConfig) {
  return {
    owner: project.owner,
    repo: project.repo,
    full_name: `${project.owner}/${project.repo}`,
  }
}

function assertMissionProject(result: ToolResult, project: ProjectConfig, packetKey: 'mission' | 'packet'): ToolResult {
  if (isFailed(result)) return result
  const nested = resultRecord(result)[packetKey]
  const record = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : null
  if (!record || record.project_id !== project.id) {
    return failure(
      'CROSS_PROJECT_ACCESS_DENIED',
      'Mission does not belong to the gateway project scope.',
      'Use a Mission created for the project bound to this gateway URL.',
      project,
    )
  }
  return result
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

function publicPullRequest(item: {
  number: number
  state: string
  draft?: boolean
  merged_at?: string | null
  mergeable_state?: string
  title: string
  html_url: string
  head: { ref: string; sha: string }
  base: { ref: string; sha: string }
  user?: { login?: string }
  created_at: string
  updated_at: string
  closed_at?: string | null
}) {
  return {
    number: item.number,
    title: item.title,
    state: item.state,
    draft: item.draft ?? false,
    merged: Boolean(item.merged_at),
    merged_at: item.merged_at ?? null,
    mergeable_state: item.mergeable_state ?? null,
    head: { branch: item.head.ref, sha: item.head.sha },
    base: { branch: item.base.ref, sha: item.base.sha },
    author: item.user?.login ?? null,
    url: item.html_url,
    created_at: item.created_at,
    updated_at: item.updated_at,
    closed_at: item.closed_at ?? null,
  }
}

async function pullRequestStatus(
  token: string,
  project: ProjectConfig,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const encodedRepo = `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}`
  let items: ReturnType<typeof publicPullRequest>[]

  if (Number.isInteger(args.number) && Number(args.number) > 0) {
    const item = await githubJson<Parameters<typeof publicPullRequest>[0]>(
      token,
      `${encodedRepo}/pulls/${Number(args.number)}`,
    )
    items = [publicPullRequest(item)]
  } else {
    const branch = optionalString(args.branch, 160)
    if (!branch) throw new Error('number or branch is required')
    const state = ['open', 'closed', 'all'].includes(String(args.state)) ? String(args.state) : 'all'
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 30)
    const query = new URLSearchParams({
      state,
      head: `${project.owner}:${branch}`,
      per_page: String(limit),
      sort: 'updated',
      direction: 'desc',
    })
    const response = await githubJson<Parameters<typeof publicPullRequest>[0][]>(
      token,
      `${encodedRepo}/pulls?${query.toString()}`,
    )
    items = response.map(publicPullRequest)
  }

  return textResult({
    ok: true,
    operation_id: crypto.randomUUID(),
    status: 'completed',
    project_id: project.id,
    repository: repositoryRef(project),
    branch: optionalString(args.branch, 160) ?? project.defaultBranch,
    result: { items, count: items.length },
  })
}

function activityEvidence(context: Record<string, unknown>): string[] {
  const references: string[] = []
  for (const key of ['project_tasks', 'handoffs', 'approvals', 'workflow_tasks']) {
    const values = Array.isArray(context[key]) ? context[key] as Record<string, unknown>[] : []
    for (const value of values) {
      for (const field of ['run_url', 'pr_url', 'task_id', 'operation_id', 'handoff_id']) {
        if (typeof value[field] === 'string' && value[field]) references.push(String(value[field]))
      }
      if (Array.isArray(value.evidence)) {
        references.push(...value.evidence.filter((item): item is string => typeof item === 'string'))
      }
    }
  }
  return [...new Set(references)].sort().slice(0, 100)
}

async function brainExportSummary(
  token: string,
  env: Env,
  project: ProjectConfig,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const contextResult = await executeProjectBrainMcpTool(
    'project_context_get',
    {
      project_id: project.id,
      include_activity: true,
      max_chars_per_document: args.max_chars_per_document,
      max_total_document_chars: args.max_total_document_chars,
    },
    token,
    env,
  ) as ToolResult
  if (isFailed(contextResult)) return contextResult

  const branchResult = await executeReadOnlyMcpTool(
    'repository_get_branch',
    { project_id: project.id, branch: project.defaultBranch },
    token,
    env,
  ) as ToolResult
  if (isFailed(branchResult)) return branchResult

  const missionResult = await executeMissionMcpTool('mission_list', { limit: 100 }, token, env) as ToolResult
  if (isFailed(missionResult)) return missionResult

  const context = resultRecord(contextResult)
  const branch = resultRecord(branchResult)
  const missionsResult = resultRecord(missionResult)
  const missions = Array.isArray(missionsResult.items)
    ? (missionsResult.items as Record<string, unknown>[])
      .filter((item) => item.project_id === project.id)
      .sort((left, right) => String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? '')))
    : []
  const documents = Array.isArray(context.canonical_documents)
    ? context.canonical_documents as Record<string, unknown>[]
    : []
  const pendingTasks = Array.isArray(context.project_tasks)
    ? (context.project_tasks as Record<string, unknown>[])
      .filter((item) => !['completed', 'cancelled'].includes(String(item.status)))
    : []
  const activeApproval = Array.isArray(context.approvals)
    ? (context.approvals as Record<string, unknown>[])[0] ?? null
    : null

  return textResult({
    ok: true,
    operation_id: crypto.randomUUID(),
    status: 'completed',
    project_id: project.id,
    repository: repositoryRef(project),
    branch: project.defaultBranch,
    result: {
      schema_version: 'bestcode-shared-context-v1',
      repository: repositoryRef(project),
      main_sha: typeof branch.sha === 'string' ? branch.sha : null,
      current_mission: missions[0] ?? null,
      architecture_decisions: documents.filter((item) => String(item.path).startsWith('docs/DECISIONS/')),
      pending_tasks: pendingTasks,
      recent_evidence: activityEvidence(context),
      active_branch_or_pr: activeApproval,
      safety_rules: documents.filter((item) => [
        'BESTCODE_MASTER.md',
        'docs/EVIDENCE_STANDARD.md',
        'docs/THREAT_MODEL.md',
      ].includes(String(item.path))),
      original_owner_intent_and_ai_interpretation_contract: 'preserved_by_project_brain',
      brain_context: context,
    },
  })
}

export async function executeSubscriptionTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
  projectScope: string,
): Promise<ToolResult> {
  let project: ProjectConfig | undefined
  try {
    project = getProject(env, projectScope)

    if (name === 'projects_list') {
      const result = await executeReadOnlyMcpTool('projects_list', {}, token, env) as ToolResult
      if (isFailed(result)) return result
      const source = resultRecord(result)
      const items = Array.isArray(source.items)
        ? (source.items as Record<string, unknown>[]).filter((item) => item.id === project!.id)
        : []
      return textResult({
        ok: true,
        operation_id: String(result.structuredContent.operation_id ?? crypto.randomUUID()),
        status: 'completed',
        project_id: project.id,
        repository: repositoryRef(project),
        branch: project.defaultBranch,
        result: { items, count: items.length, total: items.length, next_cursor: null },
      })
    }

    const requestedProject = stringValue(args.project_id, 'project_id', 64)
    if (requestedProject !== project.id) {
      return failure(
        'CROSS_PROJECT_ACCESS_DENIED',
        `Project ${requestedProject} is outside gateway scope ${project.id}.`,
        'Use the project_id returned by projects_list for this gateway URL.',
        project,
      )
    }

    switch (name) {
      case 'project_get':
        return await executeReadOnlyMcpTool('project_get', args, token, env) as ToolResult
      case 'brain_search':
        return await executeProjectBrainMcpTool('project_memory_search', args, token, env) as ToolResult
      case 'brain_export_summary':
        return brainExportSummary(token, env, project, args)
      case 'mission_get': {
        const result = await executeMissionMcpTool(
          'mission_get',
          { mission_id: args.mission_id },
          token,
          env,
        ) as ToolResult
        return assertMissionProject(result, project, 'mission')
      }
      case 'mission_context_get': {
        const result = await executeMissionMcpTool(
          'mission_context_packet',
          { mission_id: args.mission_id },
          token,
          env,
        ) as ToolResult
        return assertMissionProject(result, project, 'packet')
      }
      case 'repository_status':
        return await executeSafeWriteMcpTool('repository_status', args, token, env) as ToolResult
      case 'repository_read_file':
        return await executeReadOnlyMcpTool(
          'repository_read_file',
          { ...args, path: normalizeRepositoryPath(stringValue(args.path, 'path', 240)) },
          token,
          env,
        ) as ToolResult
      case 'repository_search':
        return await executeReadOnlyMcpTool(
          'repository_search_code',
          { ...args, query: args.query },
          token,
          env,
        ) as ToolResult
      case 'pull_request_status':
        return pullRequestStatus(token, project, args)
      case 'deployment_status':
        return await executeDeploymentMcpTool('deployment_status', args, token, env) as ToolResult
      case 'handoff_packet_build': {
        const branchName = optionalString(args.branch, 160) ?? project.defaultBranch
        const branchResult = await executeReadOnlyMcpTool(
          'repository_get_branch',
          { project_id: project.id, branch: branchName },
          token,
          env,
        ) as ToolResult
        if (isFailed(branchResult)) return branchResult
        const branch = resultRecord(branchResult)
        const baseSha = typeof branch.sha === 'string' ? branch.sha : ''
        if (!baseSha) throw new Error('Repository branch SHA is unavailable')

        const missionId = optionalString(args.mission_id, 64) ?? null
        if (missionId) {
          const mission = await executeMissionMcpTool('mission_get', { mission_id: missionId }, token, env) as ToolResult
          const scopedMission = assertMissionProject(mission, project, 'mission')
          if (isFailed(scopedMission)) return scopedMission
        }

        const rawTest = args.test_status && typeof args.test_status === 'object' && !Array.isArray(args.test_status)
          ? args.test_status as Record<string, unknown>
          : {}
        const packet = await buildHandoffPacket({
          project_id: project.id,
          mission_id: missionId,
          repository: `${project.owner}/${project.repo}`,
          base_sha: baseSha,
          branch: branchName,
          objective: stringValue(args.objective, 'objective', 4000),
          completed_work: stringList(args.completed_work),
          changed_files: changedFiles(args.changed_files),
          test_status: {
            state: optionalString(rawTest.state, 40) ?? 'not_run',
            summary: optionalString(rawTest.summary, 2000) ?? '',
            evidence_references: stringList(rawTest.evidence_references, 100, 500),
          },
          unresolved_issues: stringList(args.unresolved_issues),
          decisions_required: stringList(args.decisions_required),
          safety_constraints: stringList(args.safety_constraints),
          next_exact_action: stringValue(args.next_exact_action, 'next_exact_action', 2000),
          source_references: stringList(args.source_references, 100, 500),
          evidence_references: stringList(args.evidence_references, 100, 500),
        })
        return textResult({
          ok: true,
          operation_id: crypto.randomUUID(),
          status: 'completed',
          project_id: project.id,
          repository: repositoryRef(project),
          branch: branchName,
          result: { packet },
        })
      }
      default:
        return failure(
          'UNKNOWN_SUBSCRIPTION_TOOL',
          `Unknown subscription tool: ${name}`,
          'Call tools/list and use one of the advertised read-only tools.',
          project,
        )
    }
  } catch (error) {
    return failure(
      'SUBSCRIPTION_TOOL_FAILED',
      error instanceof Error ? error.message : String(error),
      'Correct the read-only tool arguments and retry.',
      project,
    )
  }
}
