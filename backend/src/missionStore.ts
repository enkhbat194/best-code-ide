import type { ProjectTaskRecord } from './approvalStore'
import { createProjectTask, getProjectTask, listProjectTasks, updateProjectTask } from './projectBrainClient'
import {
  assertMissionLifecycleTransition,
  assertValidMissionGraph,
  computeMissionContextHash,
  type MissionRecord,
} from './missionSchema'
import type { Env } from './types'

const STORE_PROJECT_ID = 'bestcode-missions-v1'
const SCHEMA = 'mission-record-v1'
const MAX_SERIALIZED_CHARS = 3800

type StoredMission = { schema: typeof SCHEMA; mission: MissionRecord }

function canonicalHash(mission: MissionRecord): string {
  return computeMissionContextHash({
    mission_id: mission.mission_id,
    project_id: mission.project_id,
    lifecycle: mission.lifecycle,
    context_version: mission.context_version,
    goal_ids: mission.goals.map((item) => item.goal_id),
    task_ids: mission.tasks.map((item) => item.task_id),
    decision_ids: mission.decisions.map((item) => item.decision_id),
  })
}

function encode(mission: MissionRecord): string {
  assertValidMissionGraph(mission.tasks)
  const normalized = { ...mission, context_hash: canonicalHash(mission) }
  const encoded = JSON.stringify({ schema: SCHEMA, mission: normalized } satisfies StoredMission)
  if (encoded.length > MAX_SERIALIZED_CHARS) {
    throw new Error(`Mission record exceeds the bounded v1 storage limit of ${MAX_SERIALIZED_CHARS} characters`)
  }
  return encoded
}

function decode(record: ProjectTaskRecord): MissionRecord {
  const parsed = JSON.parse(record.summary ?? '{}') as Partial<StoredMission>
  if (parsed.schema !== SCHEMA || !parsed.mission) throw new Error(`Stored Mission record is invalid: ${record.task_id}`)
  const mission = parsed.mission
  assertValidMissionGraph(mission.tasks)
  if (mission.context_hash !== canonicalHash(mission)) throw new Error(`Stored Mission context hash is invalid: ${record.task_id}`)
  return mission
}

export async function createMission(env: Env, mission: MissionRecord): Promise<MissionRecord> {
  if (mission.context_version !== 1) throw new Error('A new Mission must start at context_version 1')
  if (mission.lifecycle !== 'captured') throw new Error('A new Mission must start in captured lifecycle')
  const now = new Date().toISOString()
  const normalized: MissionRecord = { ...mission, writer_lease: null, context_hash: '', created_at: now, updated_at: now }
  const record: ProjectTaskRecord = {
    task_id: normalized.mission_id,
    project_id: STORE_PROJECT_ID,
    goal: normalized.title,
    status: 'planned',
    created_by: 'mission-control',
    summary: encode(normalized),
    evidence: [],
    created_at: now,
    updated_at: now,
  }
  return decode(await createProjectTask(env, record))
}

export async function getMission(env: Env, missionId: string): Promise<MissionRecord> {
  const record = await getProjectTask(env, missionId)
  if (record.project_id !== STORE_PROJECT_ID) throw new Error('Mission not found')
  return decode(record)
}

export async function listMissions(env: Env, limit = 30): Promise<MissionRecord[]> {
  const result = await listProjectTasks(env, { projectId: STORE_PROJECT_ID, limit: Math.min(Math.max(limit, 1), 100) })
  return result.items.map(decode)
}

export async function updateMission(
  env: Env,
  missionId: string,
  expectedContextVersion: number,
  mutate: (current: MissionRecord) => MissionRecord,
): Promise<MissionRecord> {
  const current = await getMission(env, missionId)
  if (current.context_version !== expectedContextVersion) {
    throw new Error(`Mission context version mismatch: expected ${expectedContextVersion}, current ${current.context_version}`)
  }
  const proposed = mutate(structuredClone(current))
  if (proposed.mission_id !== current.mission_id || proposed.project_id !== current.project_id) {
    throw new Error('Mission identity fields are immutable')
  }
  assertMissionLifecycleTransition(current.lifecycle, proposed.lifecycle)
  const now = new Date().toISOString()
  const updated: MissionRecord = {
    ...proposed,
    context_version: current.context_version + 1,
    context_hash: '',
    created_at: current.created_at,
    updated_at: now,
  }
  const record = await updateProjectTask(env, missionId, {
    status: 'planned',
    goal: updated.title,
    summary: encode(updated),
  })
  return decode(record)
}