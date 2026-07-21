import { useSettingsStore } from '../store/settingsStore'
import type { MissionCriterion, MissionDecision, MissionGoal, MissionTask, MissionWriterLease } from './missionClient'

interface ActionEnvelope<T> {
  ok: boolean
  result?: T
  error?: { code?: string; message?: string; action_required?: string }
}

export interface MissionContextPacket {
  schema: 'mission-context-packet-v1'
  mission_id: string
  project_id: string
  title: string
  lifecycle: string
  context_version: number
  context_hash: string
  goals: MissionGoal[]
  acceptance_criteria: MissionCriterion[]
  open_decisions: MissionDecision[]
  active_tasks: MissionTask[]
  evidence_ids: string[]
  writer_lease: MissionWriterLease | null
}

export async function getMissionContextPacket(missionId: string): Promise<MissionContextPacket> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new Error('Backend тохиргоо дутуу байна.')
  const response = await fetch(`${settings.backendUrl}/api/actions/mission_context_packet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.authToken}`,
    },
    body: JSON.stringify({ mission_id: missionId }),
  })
  const payload = await response.json().catch(() => null) as ActionEnvelope<{ packet: MissionContextPacket }> | null
  if (!response.ok || !payload?.ok || !payload.result?.packet) {
    throw new Error([payload?.error?.message, payload?.error?.action_required].filter(Boolean).join(' ') || `Context Packet HTTP ${response.status} алдаатай.`)
  }
  return payload.result.packet
}
