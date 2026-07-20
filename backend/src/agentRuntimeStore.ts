import { createProjectTask, getProjectTask, listProjectTasks, updateProjectTask } from './approvalClient'
import type { ProjectTaskRecord } from './approvalStore'
import type { AgentTaskNode } from './agentRuntime'
import type { Env } from './types'

const STORE_PROJECT_ID = 'bestcode-agent-runtime'
const SCHEMA = 'agent-runtime-task-v1'

type StoredPayload = { schema: typeof SCHEMA; task: AgentTaskNode; updated_at: string }

function encode(task: AgentTaskNode): string {
  return JSON.stringify({ schema: SCHEMA, task, updated_at: new Date().toISOString() } satisfies StoredPayload)
}

function decode(record: ProjectTaskRecord): AgentTaskNode {
  const parsed = JSON.parse(record.summary ?? '{}') as Partial<StoredPayload>
  if (parsed.schema !== SCHEMA || !parsed.task) throw new Error(`Stored Agent Runtime task is invalid: ${record.task_id}`)
  return parsed.task
}

export async function createAgentTask(env: Env, task: AgentTaskNode): Promise<AgentTaskNode> {
  const now = new Date().toISOString()
  const record: ProjectTaskRecord = {
    task_id: task.task_id,
    project_id: STORE_PROJECT_ID,
    goal: task.title,
    status: 'planned',
    created_by: task.agent_id ?? 'unassigned',
    summary: encode(task),
    evidence: [],
    created_at: now,
    updated_at: now,
  }
  return decode(await createProjectTask(env, record))
}

export async function getAgentTask(env: Env, taskId: string): Promise<AgentTaskNode> {
  const record = await getProjectTask(env, taskId)
  if (record.project_id !== STORE_PROJECT_ID) throw new Error('Agent Runtime task not found')
  return decode(record)
}

export async function listAgentTasks(env: Env, limit = 100): Promise<AgentTaskNode[]> {
  const result = await listProjectTasks(env, { projectId: STORE_PROJECT_ID, limit })
  return result.items.map(decode)
}

export async function updateAgentTask(env: Env, task: AgentTaskNode): Promise<AgentTaskNode> {
  const record = await updateProjectTask(env, task.task_id, { status: 'planned', summary: encode(task) })
  return decode(record)
}
