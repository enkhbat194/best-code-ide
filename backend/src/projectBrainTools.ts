import * as gh from './github'
import { listApprovals, listTasks } from './approvalClient'
import type { ProjectHandoffRecord, ProjectTaskRecord, ProjectTaskStatus } from './approvalStore'
import {
  createProjectHandoff,
  createProjectTask,
  getProjectTask,
  listProjectHandoffs,
  listProjectTasks,
  updateProjectTask,
} from './projectBrainClient'
import { getProject, type ProjectConfig } from './projects'
import type { Env } from './types'

const DEFAULT_MEMORY_PATHS = [
  'BESTCODE_MASTER.md',
  'docs/PROJECT_STATUS.md',
  'docs/ARCHITECTURE.md',
  'docs/ROADMAP.md',
  'docs/DECISIONS/README.md',
  'docs/DECISIONS/0001-project-brain-and-ai-roles.md',
  'README.md',
]

const outputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    operation_id: { type: 'string' },
    task_id: { type: 'string' },
    status: { type: 'string' },
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

const metadataWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

export const projectBrainMcpTools = [
  {
    name: 'project_context_get',
    title: 'Get canonical project context',
    description: 'Assemble bounded canonical memory, current development tasks, handoffs, approvals, and workflow evidence for one allowed project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        include_activity: { type: 'boolean', default: true },
        max_chars_per_document: { type: 'integer', minimum: 1000, maximum: 20000, default: 12000 },
        max_total_document_chars: { type: 'integer', minimum: 5000, maximum: 60000, default: 45000 },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'project_memory_search',
    title: 'Search canonical project memory',
    description: 'Search only the configured canonical Project Brain files on the default branch and return bounded, line-numbered evidence snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 12 },
        context_lines: { type: 'integer', minimum: 0, maximum: 4, default: 1 },
      },
      required: ['project_id', 'query'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'project_task_start',
    title: 'Start coordinated project task',
    description: 'Create durable project-level work metadata shared by ChatGPT, Claude, DeepSeek, and the PWA. This does not change repository code.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        goal: { type: 'string', maxLength: 2000 },
        created_by: { type: 'string', description: 'Agent/provider identifier, for example chatgpt, claude, or deepseek.' },
        branch: { type: 'string' },
        next_action: { type: 'string', maxLength: 1000 },
      },
      required: ['project_id', 'goal'],
    },
    outputSchema,
    annotations: metadataWriteAnnotations,
  },
  {
    name: 'project_task_list',
    title: 'List coordinated project tasks',
    description: 'List bounded project-level task state used for cross-agent coordination. Task metadata never overrides GitHub, CI, or deployment evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'project_task_get',
    title: 'Get coordinated project task',
    description: 'Read one project-level task including goal, stage, branch, summary, next action, and evidence references.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, task_id: { type: 'string' } },
      required: ['project_id', 'task_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
  {
    name: 'project_task_update',
    title: 'Update coordinated project task',
    description: 'Advance a durable project task through the locked lifecycle and record bounded summary, next action, branch, and evidence metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        task_id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['planned', 'inspecting', 'editing', 'awaiting_approval', 'validating', 'pull_request', 'merged', 'deployed', 'completed', 'blocked', 'cancelled'],
        },
        branch: { type: 'string' },
        summary: { type: 'string', maxLength: 4000 },
        next_action: { type: 'string', maxLength: 1000 },
        evidence: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
      },
      required: ['project_id', 'task_id', 'status'],
    },
    outputSchema,
    annotations: metadataWriteAnnotations,
  },
  {
    name: 'project_handoff_record',
    title: 'Record cross-agent handoff',
    description: 'Append a durable task handoff so another connected AI can continue with the same verified goal, stage, next actions, and evidence references.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        task_id: { type: 'string' },
        from_agent: { type: 'string' },
        to_agent: { type: 'string' },
        summary: { type: 'string', maxLength: 4000 },
        next_actions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 1000 } },
        evidence: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
      },
      required: ['project_id', 'task_id', 'from_agent', 'summary'],
    },
    outputSchema,
    annotations: metadataWriteAnnotations,
  },
  {
    name: 'project_handoff_list',
    title: 'List cross-agent handoffs',
    description: 'List recent durable handoffs for one project or task so a connected AI can resume work without relying on chat history.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        task_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['project_id'],
    },
    outputSchema,
    annotations: readAnnotations,
  },
] as const

interface ToolEnvelope {
  ok: boolean
  operation_id: string
  task_id?: string
  status: string
  project_id?: string
  repository?: { owner: string; repo: string; full_name: string }
  branch?: string
  result?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean; action_required: string }
}

export interface ProjectBrainToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: ToolEnvelope
  isError?: boolean
}

interface MemoryDocument {
  path: string
  sha: string
  content: string
  total_chars: number
  truncated: boolean
}

export interface MemorySearchMatch {
  path: string
  start_line: number
  end_line: number
  snippet: string
  score: number
}

function finish(envelope: ToolEnvelope): ProjectBrainToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    ...(envelope.ok ? {} : { isError: true }),
  }
}

function repository(project: ProjectConfig) {
  return { owner: project.owner, repo: project.repo, full_name: `${project.owner}/${project.repo}` }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, max)
}

function stringList(value: unknown, maxItems = 20, maxChars = 500): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxChars))
    .filter(Boolean))]
    .slice(0, maxItems)
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function memoryPaths(project: ProjectConfig): string[] {
  const configured = project.memoryPaths?.length ? project.memoryPaths : DEFAULT_MEMORY_PATHS
  return [...new Set(configured
    .map((path) => path.trim().replace(/^\/+/, ''))
    .filter((path) => path && !path.split('/').some((part) => part === '.' || part === '..')))]
    .slice(0, 20)
}

async function loadMemoryDocuments(
  token: string,
  project: ProjectConfig,
  maxCharsPerDocument: number,
  maxTotalChars: number,
): Promise<{ documents: MemoryDocument[]; missing: string[] }> {
  const documents: MemoryDocument[] = []
  const missing: string[] = []
  let remaining = maxTotalChars

  for (const path of memoryPaths(project)) {
    if (remaining <= 0) break
    const file = await gh.getFile(token, project.owner, project.repo, path, project.defaultBranch)
    if (!file) {
      missing.push(path)
      continue
    }
    const limit = Math.min(maxCharsPerDocument, remaining)
    const content = file.content.slice(0, limit)
    documents.push({
      path,
      sha: file.sha,
      content,
      total_chars: file.content.length,
      truncated: file.content.length > content.length,
    })
    remaining -= content.length
  }

  return { documents, missing }
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKC')
}

export function searchMemoryDocuments(
  documents: Pick<MemoryDocument, 'path' | 'content'>[],
  query: string,
  limit = 12,
  contextLines = 1,
): MemorySearchMatch[] {
  const phrase = normalizeSearch(query.trim())
  if (!phrase) throw new Error('query is required')
  const tokens = [...new Set(phrase.split(/[^\p{L}\p{N}._/-]+/u).filter(Boolean))]
  const matches: MemorySearchMatch[] = []

  for (const document of documents) {
    const lines = document.content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLine = normalizeSearch(lines[index])
      const tokenHits = tokens.filter((token) => normalizedLine.includes(token)).length
      const phraseHit = normalizedLine.includes(phrase)
      const tokenMatch = tokens.length > 0 && tokenHits === tokens.length
      if (!phraseHit && !tokenMatch) continue

      const start = Math.max(0, index - contextLines)
      const end = Math.min(lines.length, index + contextLines + 1)
      const snippet = lines.slice(start, end).join('\n')
      matches.push({
        path: document.path,
        start_line: start + 1,
        end_line: end,
        snippet: snippet.slice(0, 4000),
        score: (phraseHit ? 100 : 0) + tokenHits,
      })
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.start_line - b.start_line)
    .slice(0, Math.min(Math.max(limit, 1), 30))
}

function publicProjectTask(task: ProjectTaskRecord) {
  return {
    task_id: task.task_id,
    project_id: task.project_id,
    goal: task.goal,
    status: task.status,
    created_by: task.created_by,
    branch: task.branch ?? null,
    summary: task.summary ?? null,
    next_action: task.next_action ?? null,
    evidence: task.evidence,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at ?? null,
    verification: 'reported_metadata',
  }
}

function publicHandoff(handoff: ProjectHandoffRecord) {
  return {
    ...handoff,
    verification: 'reported_metadata',
  }
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/Project not found or not permitted/i.test(message)) {
    return { code: 'PROJECT_NOT_FOUND', message, retryable: false, action_required: 'Choose a project returned by projects_list.' }
  }
  if (/required|Invalid|cannot move|must start|require a summary|must match/i.test(message)) {
    return { code: 'INVALID_PROJECT_BRAIN_STATE', message, retryable: false, action_required: 'Correct the project task, handoff, or search arguments.' }
  }
  if (/not configured/i.test(message)) {
    return { code: 'PROJECT_BRAIN_NOT_CONFIGURED', message, retryable: false, action_required: 'Deploy the configured Durable Object binding and migration.' }
  }
  if (/404|not found/i.test(message)) {
    return { code: 'NOT_FOUND', message, retryable: false, action_required: 'Verify the project, task, branch, and canonical memory configuration.' }
  }
  if (/403|rate limit/i.test(message)) {
    return { code: 'GITHUB_FORBIDDEN_OR_RATE_LIMITED', message, retryable: true, action_required: 'Check GitHub permissions and rate limits.' }
  }
  return { code: 'PROJECT_BRAIN_FAILED', message, retryable: false, action_required: 'Inspect the exact error and Worker logs.' }
}

export async function executeProjectBrainMcpTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  env: Env,
): Promise<ProjectBrainToolResult> {
  const operationId = crypto.randomUUID()
  let project: ProjectConfig | undefined

  try {
    project = getProject(env, requireString(args, 'project_id'))
    const baseFields = {
      project_id: project.id,
      repository: repository(project),
      branch: project.defaultBranch,
    }

    switch (name) {
      case 'project_context_get': {
        const maxPerDocument = boundedInteger(args.max_chars_per_document, 12000, 1000, 20000)
        const maxTotal = boundedInteger(args.max_total_document_chars, 45000, 5000, 60000)
        const memory = await loadMemoryDocuments(token, project, maxPerDocument, maxTotal)
        const includeActivity = args.include_activity !== false
        const [projectTasks, handoffs, approvals, workflowTasks] = includeActivity
          ? await Promise.all([
              listProjectTasks(env, { projectId: project.id, limit: 20 }),
              listProjectHandoffs(env, { projectId: project.id, limit: 20 }),
              listApprovals(env, { projectId: project.id, limit: 20 }),
              listTasks(env, { projectId: project.id, limit: 20 }),
            ])
          : [
              { items: [], count: 0, total: 0 },
              { items: [], count: 0, total: 0 },
              { items: [], count: 0, total: 0 },
              { items: [], count: 0, total: 0 },
            ]
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...baseFields,
          result: {
            context_version: 'project-brain-v1',
            source_priority: [
              'github_main',
              'production_deployment',
              'locked_master_and_decisions',
              'github_pr_ci_deployment_evidence',
              'durable_project_activity',
              'ai_chat_summary',
            ],
            project: {
              id: project.id,
              name: project.name,
              description: project.description ?? '',
              default_branch: project.defaultBranch,
            },
            canonical_documents: memory.documents,
            missing_canonical_paths: memory.missing,
            project_tasks: projectTasks.items.map(publicProjectTask),
            handoffs: handoffs.items.map(publicHandoff),
            approvals: approvals.items.map((item) => ({
              operation_id: item.operation_id,
              title: item.title,
              status: item.status,
              branch: item.branch,
              risk: item.risk,
              updated_at: item.updated_at,
              pr_url: item.pr_url ?? null,
            })),
            workflow_tasks: workflowTasks.items.map((item) => ({
              task_id: item.task_id,
              kind: item.kind,
              branch: item.branch,
              status: item.status,
              conclusion: item.conclusion ?? null,
              run_url: item.run_url ?? null,
              updated_at: item.updated_at,
            })),
          },
        })
      }

      case 'project_memory_search': {
        const query = requireString(args, 'query')
        const limit = boundedInteger(args.limit, 12, 1, 30)
        const contextLines = boundedInteger(args.context_lines, 1, 0, 4)
        const memory = await loadMemoryDocuments(token, project, 30000, 120000)
        const matches = searchMemoryDocuments(memory.documents, query, limit, contextLines)
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...baseFields,
          result: {
            query,
            scope: 'configured_canonical_memory_on_default_branch',
            items: matches,
            count: matches.length,
            searched_paths: memory.documents.map((item) => item.path),
            missing_paths: memory.missing,
          },
        })
      }

      case 'project_task_start': {
        const now = new Date().toISOString()
        const task: ProjectTaskRecord = {
          task_id: crypto.randomUUID(),
          project_id: project.id,
          goal: requireString(args, 'goal').slice(0, 2000),
          status: 'planned',
          created_by: optionalString(args, 'created_by', 80) ?? 'connected-ai',
          branch: optionalString(args, 'branch', 160),
          next_action: optionalString(args, 'next_action', 1000),
          evidence: [],
          created_at: now,
          updated_at: now,
        }
        const created = await createProjectTask(env, task)
        return finish({
          ok: true,
          operation_id: operationId,
          task_id: created.task_id,
          status: 'completed',
          ...baseFields,
          result: { task: publicProjectTask(created) },
        })
      }

      case 'project_task_list': {
        const status = optionalString(args, 'status', 40)
        const limit = boundedInteger(args.limit, 30, 1, 100)
        const tasks = await listProjectTasks(env, { projectId: project.id, status, limit })
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...baseFields,
          result: { items: tasks.items.map(publicProjectTask), count: tasks.count, total: tasks.total },
        })
      }

      case 'project_task_get': {
        const task = await getProjectTask(env, requireString(args, 'task_id'))
        if (task.project_id !== project.id) throw new Error('Project task not found for this project')
        return finish({
          ok: true,
          operation_id: operationId,
          task_id: task.task_id,
          status: 'completed',
          ...baseFields,
          result: { task: publicProjectTask(task) },
        })
      }

      case 'project_task_update': {
        const taskId = requireString(args, 'task_id')
        const task = await getProjectTask(env, taskId)
        if (task.project_id !== project.id) throw new Error('Project task not found for this project')
        const status = requireString(args, 'status') as ProjectTaskStatus
        const updated = await updateProjectTask(env, taskId, {
          status,
          branch: optionalString(args, 'branch', 160),
          summary: optionalString(args, 'summary', 4000),
          next_action: optionalString(args, 'next_action', 1000),
          evidence: args.evidence === undefined ? task.evidence : stringList(args.evidence),
        })
        return finish({
          ok: true,
          operation_id: operationId,
          task_id: updated.task_id,
          status: 'completed',
          ...baseFields,
          result: { task: publicProjectTask(updated) },
        })
      }

      case 'project_handoff_record': {
        const taskId = requireString(args, 'task_id')
        const task = await getProjectTask(env, taskId)
        if (task.project_id !== project.id) throw new Error('Project task not found for this project')
        const handoff: ProjectHandoffRecord = {
          handoff_id: crypto.randomUUID(),
          project_id: project.id,
          task_id: taskId,
          from_agent: requireString(args, 'from_agent').slice(0, 80),
          to_agent: optionalString(args, 'to_agent', 80),
          summary: requireString(args, 'summary').slice(0, 4000),
          next_actions: stringList(args.next_actions, 20, 1000),
          evidence: stringList(args.evidence),
          created_at: new Date().toISOString(),
        }
        const created = await createProjectHandoff(env, handoff)
        return finish({
          ok: true,
          operation_id: operationId,
          task_id: taskId,
          status: 'completed',
          ...baseFields,
          result: { handoff: publicHandoff(created) },
        })
      }

      case 'project_handoff_list': {
        const taskId = optionalString(args, 'task_id', 64)
        const limit = boundedInteger(args.limit, 20, 1, 100)
        const handoffs = await listProjectHandoffs(env, { projectId: project.id, taskId, limit })
        return finish({
          ok: true,
          operation_id: operationId,
          status: 'completed',
          ...baseFields,
          result: { items: handoffs.items.map(publicHandoff), count: handoffs.count, total: handoffs.total },
        })
      }

      default:
        throw new Error(`Unknown Project Brain tool: ${name}`)
    }
  } catch (error) {
    return finish({
      ok: false,
      operation_id: operationId,
      status: 'failed',
      ...(project ? { project_id: project.id, repository: repository(project), branch: project.defaultBranch } : {}),
      error: classifyError(error),
    })
  }
}
