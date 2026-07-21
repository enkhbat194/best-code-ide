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

interface MissionLease {
  lease_id: string
  holder_id: string
  expires_at: string
}

interface MissionRecord {
  mission_id: string
  project_id: string
  lifecycle: string
  context_version: number
  context_hash: string
  writer_lease: MissionLease | null
  goals: Array<{ goal_id: string; title: string }>
}

interface MissionPacket {
  schema: string
  mission_id: string
  context_version: number
  context_hash: string
  goals: Array<{ goal_id: string; title: string }>
}

interface CanaryIds {
  missionId: string
  goalId: string
  mutationOperationId: string
  idempotencyKey: string
}

export type SmokeStepStatus = 'pending' | 'passed' | 'failed'

export interface MissionSmokeStep {
  key: 'create' | 'get' | 'guard' | 'mutate' | 'packet' | 'cleanup'
  label: string
  status: SmokeStepStatus
  detail: string
}

export interface MissionSmokeReport {
  ok: boolean
  missionId: string
  contextVersion?: number
  contextHash?: string
  completedAt: string
  steps: MissionSmokeStep[]
}

const CANARY_STORAGE_KEY = 'bestcode:phase4a-smoke-canary:v1'
const HOLDER_ID = 'bestcode-pwa-phase4a-smoke'

class ActionFailure extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ActionFailure'
    this.code = code
  }
}

async function action<T>(name: string, body: Record<string, unknown>): Promise<ActionEnvelope<T>> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new ActionFailure('BACKEND_NOT_CONFIGURED', 'Backend тохиргоо дутуу байна.')

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
    throw new ActionFailure(code, message)
  }
  return payload
}

function freshCanaryIds(): CanaryIds {
  const missionId = crypto.randomUUID()
  return {
    missionId,
    goalId: crypto.randomUUID(),
    mutationOperationId: crypto.randomUUID(),
    idempotencyKey: `phase4a.smoke.${missionId}`,
  }
}

function canaryIds(): CanaryIds {
  try {
    const stored = window.localStorage.getItem(CANARY_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<CanaryIds>
      if (parsed.missionId && parsed.goalId && parsed.mutationOperationId && parsed.idempotencyKey) return parsed as CanaryIds
    }
    const created = freshCanaryIds()
    window.localStorage.setItem(CANARY_STORAGE_KEY, JSON.stringify(created))
    return created
  } catch {
    return freshCanaryIds()
  }
}

async function resolveProjectId(): Promise<string> {
  const settings = useSettingsStore.getState()
  const expectedRepository = `${settings.owner}/${settings.repo}`.toLowerCase()
  const response = await action<{ items: ProjectListItem[] }>('projects_list', { limit: 50 })
  const project = response.result!.items.find((item) => item.repository.toLowerCase() === expectedRepository)
  if (!project) throw new ActionFailure('PROJECT_NOT_FOUND', 'Project registry-д одоогийн repository олдсонгүй.')
  return project.id
}

function initialSteps(): MissionSmokeStep[] {
  return [
    { key: 'create', label: '1. mission_create', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'get', label: '2. mission_get', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'guard', label: 'Writer lease ба concurrency', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'mutate', label: '3. mission_mutate', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'packet', label: '4. mission_context_packet', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'cleanup', label: 'Lease cleanup', status: 'pending', detail: 'Хүлээгдэж байна' },
  ]
}

export async function runPhase4ASmokeTest(): Promise<MissionSmokeReport> {
  const ids = canaryIds()
  const steps = initialSteps()
  let activeKey: MissionSmokeStep['key'] = 'create'
  let mission: MissionRecord | null = null
  let leaseId: string | null = null
  let packet: MissionPacket | null = null

  const update = (key: MissionSmokeStep['key'], status: SmokeStepStatus, detail: string) => {
    const step = steps.find((item) => item.key === key)
    if (step) Object.assign(step, { status, detail })
  }

  try {
    const projectId = await resolveProjectId()

    activeKey = 'create'
    try {
      const created = await action<{ mission: MissionRecord }>('mission_create', {
        mission_id: ids.missionId,
        project_id: projectId,
        title: 'Phase 4A production smoke canary',
      })
      mission = created.result!.mission
      update('create', 'passed', `Шинэ canary Mission үүслээ · v${mission.context_version}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already exists/i.test(message)) throw error
      const existing = await action<{ mission: MissionRecord }>('mission_get', { mission_id: ids.missionId })
      mission = existing.result!.mission
      update('create', 'passed', 'Өмнөх амжилттай canary Mission-ийг дахин ашиглав')
    }

    activeKey = 'get'
    const read = await action<{ mission: MissionRecord }>('mission_get', { mission_id: ids.missionId })
    mission = read.result!.mission
    if (!mission.context_hash || mission.mission_id !== ids.missionId) throw new Error('Mission read payload-ийн ID эсвэл context hash буруу байна.')
    update('get', 'passed', `${mission.lifecycle} · v${mission.context_version} · ${mission.context_hash}`)

    activeKey = 'guard'
    const requestedLeaseId = crypto.randomUUID()
    const leased = await action<{ mission: MissionRecord }>('mission_lease', {
      mission_id: ids.missionId,
      expected_context_version: mission.context_version,
      command: 'acquire',
      holder_id: HOLDER_ID,
      lease_id: requestedLeaseId,
      ttl_seconds: 120,
    })
    mission = leased.result!.mission
    leaseId = mission.writer_lease?.lease_id || null
    if (!leaseId || mission.writer_lease?.holder_id !== HOLDER_ID) throw new Error('Writer lease зөв эзэмшигчид олгогдсонгүй.')

    let secondWriterBlocked = false
    try {
      await action<{ mission: MissionRecord }>('mission_lease', {
        mission_id: ids.missionId,
        expected_context_version: mission.context_version,
        command: 'acquire',
        holder_id: 'bestcode-pwa-second-writer-canary',
        lease_id: crypto.randomUUID(),
        ttl_seconds: 30,
      })
    } catch (error) {
      secondWriterBlocked = /held by|active writer lease/i.test(error instanceof Error ? error.message : String(error))
    }
    if (!secondWriterBlocked) throw new Error('Хоёр дахь writer блоклогдсонгүй.')
    update('guard', 'passed', `Нэг writer lease хүчинтэй · ${leaseId.slice(0, 8)}`)

    activeKey = 'mutate'
    const mutated = await action<{ mission: MissionRecord }>('mission_mutate', {
      mission_id: ids.missionId,
      expected_context_version: mission.context_version,
      holder_id: HOLDER_ID,
      lease_id: leaseId,
      idempotency_key: ids.idempotencyKey,
      operation_id: ids.mutationOperationId,
      mutation: 'add_goal',
      entity: {
        goal_id: ids.goalId,
        title: 'Verify Phase 4A production contract',
        outcome: 'Create, read, lease, mutate, context packet, and cleanup all pass from the installed PWA.',
      },
    })
    mission = mutated.result!.mission
    if (!mission.goals.some((goal) => goal.goal_id === ids.goalId)) throw new Error('Canary Goal Mission-д хадгалагдсангүй.')

    let staleVersionBlocked = false
    try {
      await action<{ mission: MissionRecord }>('mission_transition', {
        mission_id: ids.missionId,
        expected_context_version: Math.max(1, mission.context_version - 1),
        lifecycle: mission.lifecycle,
      })
    } catch (error) {
      staleVersionBlocked = /version mismatch/i.test(error instanceof Error ? error.message : String(error))
    }
    if (!staleVersionBlocked) throw new Error('Stale context_version хүсэлт блоклогдсонгүй.')
    update('mutate', 'passed', `Goal хадгалагдсан; stale version блоклогдсон · v${mission.context_version}`)

    activeKey = 'packet'
    const context = await action<{ packet: MissionPacket }>('mission_context_packet', { mission_id: ids.missionId })
    packet = context.result!.packet
    if (packet.mission_id !== ids.missionId || packet.context_hash !== mission.context_hash || !packet.goals.some((goal) => goal.goal_id === ids.goalId)) {
      throw new Error('Context packet Mission-ийн current state-тэй таарахгүй байна.')
    }
    update('packet', 'passed', `${packet.schema} · v${packet.context_version} · ${packet.context_hash}`)
  } catch (error) {
    update(activeKey, 'failed', error instanceof Error ? error.message : String(error))
  } finally {
    activeKey = 'cleanup'
    if (leaseId) {
      try {
        const latest = await action<{ mission: MissionRecord }>('mission_get', { mission_id: ids.missionId })
        const released = await action<{ mission: MissionRecord }>('mission_lease', {
          mission_id: ids.missionId,
          expected_context_version: latest.result!.mission.context_version,
          command: 'release',
          holder_id: HOLDER_ID,
        })
        mission = released.result!.mission
        update('cleanup', 'passed', 'Writer lease суллагдсан')
      } catch (error) {
        update('cleanup', 'failed', error instanceof Error ? error.message : String(error))
      }
    } else {
      update('cleanup', 'passed', 'Суллах lease үүсээгүй')
    }
  }

  const ok = steps.every((step) => step.status === 'passed')
  return {
    ok,
    missionId: ids.missionId,
    contextVersion: packet?.context_version ?? mission?.context_version,
    contextHash: packet?.context_hash ?? mission?.context_hash,
    completedAt: new Date().toISOString(),
    steps,
  }
}
