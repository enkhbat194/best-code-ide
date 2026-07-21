import { createMissionFromIntent, getMission, listMissions, resolveMissionDecision, type MissionDecision, type MissionRecord } from './missionClient'
import { serializeIntentWithReferences, type IntentReference } from './intentCapture'
import { useSettingsStore } from '../store/settingsStore'

interface ActionEnvelope<T> {
  ok: boolean
  result?: T
  error?: { code?: string; message?: string; action_required?: string }
}

export const PHASE4B_CLOSEOUT_TITLE_PREFIX = 'Phase 4B owner closeout canary'

export const PHASE4B_CLOSEOUT_DECISIONS = [
  {
    key: 'accept',
    title: '[4B closeout] Зөвшөөрөх үйлдлийг турших',
    expectedStatus: 'accepted' as const,
    rationale: 'Owner Decision inbox дээр Зөвшөөрөх товчийг production орчинд шалгана.',
    buttonLabel: 'Зөвшөөрөх',
  },
  {
    key: 'reject',
    title: '[4B closeout] Татгалзах үйлдлийг турших',
    expectedStatus: 'rejected' as const,
    rationale: 'Owner Decision inbox дээр Татгалзах товчийг production орчинд шалгана.',
    buttonLabel: 'Татгалзах',
  },
  {
    key: 'supersede',
    title: '[4B closeout] Хуучирсан үйлдлийг турших',
    expectedStatus: 'superseded' as const,
    rationale: 'Owner Decision inbox дээр Хуучирсан товчийг production орчинд шалгана.',
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
    idempotency_key: `phase4b.closeout.${mission.mission_id}.${spec.key}`,
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
    intent: serializeIntentWithReferences(
      'Installed iOS PWA дээр зураг, файл, URL metadata capture болон Decision inbox-ийн гурван owner үйлдлийг production орчинд баталгаажуулна.',
      references,
    ),
    acceptanceCriteria: [
      'Зураг, файл, URL metadata Mission Goal-д хадгалагдаж binary агуулга хадгалагдахгүй.',
      'Decision inbox дээр accepted, rejected, superseded төлөв тус бүр нэг удаа амжилттай хадгалагдана.',
      'Бүх шийдвэр хаагдсаны дараа writer lease null болж lifecycle planned төлөвт буцна.',
    ],
  })
  return seedPhase4BCloseoutDecisions(mission.mission_id)
}

export async function seedPhase4BCloseoutDecisions(missionId: string): Promise<MissionRecord> {
  let mission = await getMission(missionId)
  const missing = PHASE4B_CLOSEOUT_DECISIONS.filter((spec) => !mission.decisions.some((decision) => decision.title === spec.title))
  if (missing.length === 0) return mission

  const holderId = `bestcode-phase4b-closeout-${crypto.randomUUID()}`
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
  const decision = findCloseoutDecision(mission, spec.title)
  if (!decision) throw new Error('Closeout шийдвэр олдсонгүй. Шалгалтын төлөвөө шинэчилнэ үү.')
  if (decision.status !== 'open') return getMission(mission.mission_id)
  return resolveMissionDecision(
    mission.mission_id,
    decision.decision_id,
    spec.expectedStatus,
    `Phase 4B owner closeout: ${spec.buttonLabel} үйлдлийг production дээр баталгаажуулав.`,
  )
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
