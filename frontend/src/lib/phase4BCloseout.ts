import { createMissionFromIntent, getMission, listMissions, type MissionDecision, type MissionRecord } from './missionClient'
import type { IntentReference } from './intentCapture'
import { useSettingsStore } from '../store/settingsStore'

interface ActionEnvelope<T> {
  ok: boolean
  result?: T
  error?: { code?: string; message?: string; action_required?: string }
}

export const PHASE4B_CLOSEOUT_TITLE_PREFIX = '4B closeout v2'

export const PHASE4B_CLOSEOUT_DECISIONS = [
  {
    key: 'a',
    title: '[4B] Accept',
    expectedStatus: 'accepted' as const,
    rationale: '4B accept test',
    buttonLabel: 'Зөвшөөрөх',
  },
  {
    key: 'r',
    title: '[4B] Reject',
    expectedStatus: 'rejected' as const,
    rationale: '4B reject test',
    buttonLabel: 'Татгалзах',
  },
  {
    key: 's',
    title: '[4B] Supersede',
    expectedStatus: 'superseded' as const,
    rationale: '4B supersede test',
    buttonLabel: 'Хуучирсан',
  },
] as const

async function action<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new Error('Backend тохиргоо дутуу байна.')
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
    const message = [payload?.error?.message, payload?.error?.action_required].filter(Boolean).join(' ') || `${name} хүсэлт амжилтгүй.`
    throw new Error(message)
  }
  return payload.result
}

function compact(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function serializeCloseoutReferences(references: IntentReference[]): string {
  const order = ['image', 'file', 'url'] as const
  const lines = order.map((kind) => {
    const reference = references.find((item) => item.kind === kind)
    if (!reference) throw new Error('Closeout metadata reference дутуу байна.')
    const type = kind === 'image' ? 'зураг' : kind === 'file' ? 'файл' : 'URL'
    const detailLimit = kind === 'url' ? 96 : 56
    return `- ${type}: ${compact(reference.label, 32)} (${compact(reference.detail, detailLimit)})`
  })
  return `4B owner closeout (binary хадгалаагүй):\n${lines.join('\n')}`
}

async function transitionMission(mission: MissionRecord, lifecycle: string): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_transition', {
    mission_id: mission.mission_id,
    expected_context_version: mission.context_version,
    lifecycle,
  })
  return result.mission
}

async function acquireLease(mission: MissionRecord, holderId: string, leaseId: string): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_lease', {
    mission_id: mission.mission_id,
    expected_context_version: mission.context_version,
    command: 'acquire',
    holder_id: holderId,
    lease_id: leaseId,
    ttl_seconds: 180,
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

async function recordDecision(
  mission: MissionRecord,
  holderId: string,
  leaseId: string,
  spec: typeof PHASE4B_CLOSEOUT_DECISIONS[number],
): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_mutate', {
    mission_id: mission.mission_id,
    expected_context_version: mission.context_version,
    holder_id: holderId,
    lease_id: leaseId,
    idempotency_key: `p4b.s.${mission.mission_id}.${spec.key}`,
    operation_id: crypto.randomUUID(),
    mutation: 'record_decision',
    entity: {
      decision_id: crypto.randomUUID(),
      title: spec.title,
      rationale: spec.rationale,
    },
  })
  return result.mission
}

async function resolveDecisionMutation(
  mission: MissionRecord,
  holderId: string,
  leaseId: string,
  decision: MissionDecision,
  spec: typeof PHASE4B_CLOSEOUT_DECISIONS[number],
): Promise<MissionRecord> {
  const result = await action<{ mission: MissionRecord }>('mission_mutate', {
    mission_id: mission.mission_id,
    expected_context_version: mission.context_version,
    holder_id: holderId,
    lease_id: leaseId,
    idempotency_key: `p4b.r.${decision.decision_id}.${spec.key}`,
    operation_id: crypto.randomUUID(),
    mutation: 'resolve_decision',
    entity: {
      decision_id: decision.decision_id,
      status: spec.expectedStatus,
      rationale: `4B ${spec.expectedStatus}`,
    },
  })
  return result.mission
}

export async function findLatestPhase4BCloseoutMission(): Promise<MissionRecord | null> {
  const missions = await listMissions(100)
  return missions
    .filter((mission) => mission.title.startsWith(PHASE4B_CLOSEOUT_TITLE_PREFIX))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
}

export async function createPhase4BCloseoutMission(references: IntentReference[]): Promise<MissionRecord> {
  const kinds = new Set(references.map((reference) => reference.kind))
  if (!kinds.has('image') || !kinds.has('file') || !kinds.has('url')) {
    throw new Error('Нэг зураг, нэг файл, нэг URL сонгосны дараа шалгалтыг эхлүүлнэ.')
  }

  const mission = await createMissionFromIntent({
    title: `${PHASE4B_CLOSEOUT_TITLE_PREFIX} · ${new Date().toLocaleString('mn-MN')}`,
    intent: serializeCloseoutReferences(references),
    acceptanceCriteria: [],
  })
  return seedPhase4BCloseoutDecisions(mission.mission_id)
}

export async function seedPhase4BCloseoutDecisions(missionId: string): Promise<MissionRecord> {
  let mission = await getMission(missionId)
  const missing = PHASE4B_CLOSEOUT_DECISIONS.filter((spec) => !mission.decisions.some((decision) => decision.title === spec.title))
  if (missing.length === 0) return mission

  const holderId = `p4b-${crypto.randomUUID()}`
  const leaseId = crypto.randomUUID()
  let leaseAcquired = false
  try {
    mission = await acquireLease(mission, holderId, leaseId)
    leaseAcquired = true
    for (const spec of missing) mission = await recordDecision(mission, holderId, leaseId, spec)
    mission = await releaseLease(missionId, holderId)
    leaseAcquired = false
    if (mission.lifecycle !== 'decision') mission = await transitionMission(mission, 'decision')
    return mission
  } catch (error) {
    if (leaseAcquired) {
      try {
        await releaseLease(missionId, holderId)
      } catch {
        // The bounded lease expires automatically. Preserve the original error.
      }
    }
    throw error
  }
}

export function findCloseoutDecision(mission: MissionRecord, title: string): MissionDecision | undefined {
  return mission.decisions.find((decision) => decision.title === title)
}

export async function resolvePhase4BCloseoutDecision(
  mission: MissionRecord,
  spec: typeof PHASE4B_CLOSEOUT_DECISIONS[number],
): Promise<MissionRecord> {
  let latest = await getMission(mission.mission_id)
  const decision = findCloseoutDecision(latest, spec.title)
  if (!decision) throw new Error('Closeout шийдвэр олдсонгүй. Шалгалтын төлөвөө шинэчилнэ үү.')
  if (decision.status !== 'open') return latest

  const holderId = `p4b-${crypto.randomUUID()}`
  const leaseId = crypto.randomUUID()
  let leaseAcquired = false
  try {
    latest = await acquireLease(latest, holderId, leaseId)
    leaseAcquired = true
    latest = await resolveDecisionMutation(latest, holderId, leaseId, decision, spec)
    latest = await releaseLease(latest.mission_id, holderId)
    leaseAcquired = false
    if (latest.lifecycle === 'decision' && latest.decisions.every((item) => item.status !== 'open')) {
      latest = await transitionMission(latest, 'planned')
    }
    return latest
  } catch (error) {
    if (leaseAcquired) {
      try {
        await releaseLease(latest.mission_id, holderId)
      } catch {
        // Preserve the original failure; the lease expires automatically.
      }
    }
    throw error
  }
}

export function evaluatePhase4BCloseout(mission: MissionRecord) {
  const outcome = mission.goals.map((goal) => goal.outcome).join('\n')
  const decisionChecks = PHASE4B_CLOSEOUT_DECISIONS.map((spec) => {
    const decision = findCloseoutDecision(mission, spec.title)
    return { spec, decision, passed: decision?.status === spec.expectedStatus }
  })
  const capture = {
    image: /(^|\n)- зураг:/m.test(outcome),
    file: /(^|\n)- файл:/m.test(outcome),
    url: /(^|\n)- URL:/m.test(outcome),
    binaryNotStored: outcome.includes('binary хадгалаагүй'),
  }
  const allDecisionsPassed = decisionChecks.every((item) => item.passed)
  const leaseReleased = mission.writer_lease === null
  const lifecycleRecovered = allDecisionsPassed && mission.lifecycle === 'planned'
  return {
    capture,
    decisionChecks,
    leaseReleased,
    lifecycleRecovered,
    complete: capture.image && capture.file && capture.url && capture.binaryNotStored && allDecisionsPassed && leaseReleased && lifecycleRecovered,
  }
}
