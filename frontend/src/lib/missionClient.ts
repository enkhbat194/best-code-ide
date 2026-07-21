import { useSettingsStore } from '../store/settingsStore'

interface ActionEnvelope<T> {
  ok: boolean
  operation_id: string
  status: string
  result?: T
  error?: { code?: string; message?: string; action_required?: string }
}

interface ProjectListItem {
  id: string
  repository: string
}

export interface MissionGoal {
  goal_id: string
  title: string
  outcome: string
  created_at: string
}

export interface MissionCriterion {
  criterion_id: string
  statement: string
  status: 'pending' | 'passed' | 'failed'
  evidence_ids: string[]
}

export interface MissionDecision {
  decision_id: string
  title: string
  status: 'open' | 'accepted' | 'rejected' | 'superseded'
  rationale: string
  decided_at: string | null
}

export interface MissionTask {
  task_id: string
  title: string
  priority: 'critical' | 'high' | 'normal' | 'low' | 'background'
  status: 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'completed' | 'cancelled'
  dependency_ids: string[]
  operation_ids: string[]
  assigned_agent_id: string | null
  created_at: string
  updated_at: string
}

export interface MissionOperation {
  operation_id: string
  kind: string
  status: string
  task_id: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

export interface MissionWriterLease {
  lease_id: string
  holder_id: string
  acquired_at: string
  heartbeat_at: string
  expires_at: string
  context_version: number
}

export interface MissionRecord {
  mission_id: string
  project_id: string
  title: string
  lifecycle: string
  goals: MissionGoal[]
  acceptance_criteria: MissionCriterion[]
  decisions: MissionDecision[]
  tasks: MissionTask[]
  operations: MissionOperation[]
  writer_lease: MissionWriterLease | null
  context_version: number
  context_hash: string
  created_at: string
  updated_at: string
}

export interface MissionIntentDraft {
  title: string
  intent: string
}

export interface MissionCreationDraft extends MissionIntentDraft {
  acceptanceCriteria?: string[]
}

export class MissionClientError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MissionClientError'
    this.code = code
  }
}

async function action<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new MissionClientError('BACKEND_NOT_CONFIGURED', 'Backend тохиргоо дутуу байна.')

  const response = await fetch(`${settings.backendUrl}/api/actions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.authToken}`,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as ActionEnvelope<T> | null
  if (!response.ok || !payload?.ok || !payload.result) {
    const code = payload?.error?.code || `HTTP_${response.status}`
    const message = [payload?.error?.message, payload?.error?.action_required].filter(Boolean).join(' ') || `${name} хүсэлт амжилтгүй.`
    throw new MissionClientError(code, message)
  }
  return payload.result
}

async function resolveProjectId(): Promise<string> {
  const settings = useSettingsStore.getState()
  const repository = `${settings.owner}/${settings.repo}`.toLowerCase()
  const result = await action<{ items: ProjectListItem[] }>('projects_list', { limit: 50 })
  const project = result.items.find((item) => item.repository.toLowerCase() === repository)
  if (!project) throw new MissionClientError('PROJECT_NOT_FOUND', 'Project registry-д одоогийн repository олдсонгүй.')
  return project.id
}

export async function listMissions(limit = 30): Promise<MissionRecord[]> {
  const result = await action<{ items: MissionRecord[]; count: number }>('mission_list', { limit })
  return result.items
}

export async function getMission(missionId: string): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_get', { mission_id: missionId })
  return result.mission
}

async function transitionMission(mission: MissionRecord, lifecycle: string): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_transition', {
    mission_id: mission.mission_id,
    expected_context_version: mission.context_version,
    lifecycle,
  })
  return result.mission
}

async function releaseLease(missionId: string, holderId: string): Promise<MissionRecord> {
  const latest = await getMission(missionId)
  const result = await action<{ mission: MissionRecord }>('mission_lease', {
    mission_id: missionId,
    expected_context_version: latest.context_version,
    command: 'release',
    holder_id: holderId,
  })
  return result.mission
}

async function mutateMission(
  mission: MissionRecord,
  holderId: string,
  leaseId: string,
  mutation: 'add_goal' | 'add_criterion',
  idempotencyKey: string,
  entity: Record<string, unknown>,
): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_mutate', {
    mission_id: mission.mission_id,
    expected_context_version: mission.context_version,
    holder_id: holderId,
    lease_id: leaseId,
    idempotency_key: idempotencyKey,
    operation_id: crypto.randomUUID(),
    mutation,
    entity,
  })
  return result.mission
}

export async function createMissionFromIntent(draft: MissionCreationDraft): Promise<MissionRecord> {
  const title = draft.title.trim()
  const intent = draft.intent.trim()
  const criteria = [...new Set((draft.acceptanceCriteria ?? []).map((item) => item.trim().slice(0, 180)).filter(Boolean))].slice(0, 4)
  if (!title) throw new MissionClientError('TITLE_REQUIRED', 'Mission нэр оруулна уу.')
  if (!intent) throw new MissionClientError('INTENT_REQUIRED', 'Хүссэн үр дүнгээ тайлбарлана уу.')

  const projectId = await resolveProjectId()
  const missionId = crypto.randomUUID()
  const holderId = `bestcode-pwa-canvas-${crypto.randomUUID()}`
  const leaseId = crypto.randomUUID()
  let leaseAcquired = false

  const created = await action<{ mission: MissionRecord }>('mission_create', {
    mission_id: missionId,
    project_id: projectId,
    title: title.slice(0, 300),
  })
  let mission = await transitionMission(created.mission, 'framing')

  try {
    const leased = await action<{ mission: MissionRecord }>('mission_lease', {
      mission_id: missionId,
      expected_context_version: mission.context_version,
      command: 'acquire',
      holder_id: holderId,
      lease_id: leaseId,
      ttl_seconds: 180,
    })
    mission = leased.mission
    leaseAcquired = true

    mission = await mutateMission(
      mission,
      holderId,
      leaseId,
      'add_goal',
      `mission.canvas.capture.${missionId}`,
      {
        goal_id: crypto.randomUUID(),
        title: title.slice(0, 300),
        outcome: intent.slice(0, 1000),
      },
    )

    for (const [index, statement] of criteria.entries()) {
      mission = await mutateMission(
        mission,
        holderId,
        leaseId,
        'add_criterion',
        `mission.canvas.criterion.${missionId}.${index}`,
        {
          criterion_id: crypto.randomUUID(),
          statement,
          evidence_ids: [],
        },
      )
    }

    mission = await releaseLease(missionId, holderId)
    leaseAcquired = false
    return transitionMission(mission, 'planned')
  } catch (error) {
    if (leaseAcquired) {
      try {
        await releaseLease(missionId, holderId)
      } catch {
        // Preserve the original failure. The bounded lease expires automatically.
      }
    }
    throw error
  }
}
