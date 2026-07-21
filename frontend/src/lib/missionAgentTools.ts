import { getMission, listMissions } from './missionClient'
import { getMissionContextPacket } from './missionPacketClient'

const missionIdSchema = {
  type: 'string',
  pattern: '^[a-fA-F0-9-]{16,64}$',
  description: 'Durable Mission UUID shown in Mission Canvas.',
} as const

export const MISSION_AGENT_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'mission_list',
      description:
        'List durable BestCode Missions from the authenticated backend. These are Mission Canvas records, not local files or GitHub documents. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mission_get',
      description:
        'Read one durable BestCode Mission by Mission ID, including lifecycle, goals, criteria, decisions, tasks, context version/hash and writer lease. Read-only.',
      parameters: {
        type: 'object',
        properties: { mission_id: missionIdSchema },
        required: ['mission_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mission_context_packet',
      description:
        'Read the provider-neutral Mission Context Packet for a Mission ID. Use this first when asked to resume, inspect or hand off a Mission. Read-only.',
      parameters: {
        type: 'object',
        properties: { mission_id: missionIdSchema },
        required: ['mission_id'],
      },
    },
  },
] as const

function requireMissionId(value: unknown): string {
  const missionId = String(value ?? '').trim()
  if (!/^[a-fA-F0-9-]{16,64}$/.test(missionId)) {
    throw new Error('mission_id must be a UUID-style identifier')
  }
  return missionId
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value ?? 30)
  if (!Number.isFinite(parsed)) return 30
  return Math.min(Math.max(Math.floor(parsed), 1), 100)
}

export async function executeMissionAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (name === 'mission_list') {
    const items = await listMissions(boundedLimit(args.limit))
    return JSON.stringify(
      {
        count: items.length,
        items: items.map((mission) => ({
          mission_id: mission.mission_id,
          project_id: mission.project_id,
          title: mission.title,
          lifecycle: mission.lifecycle,
          context_version: mission.context_version,
          context_hash: mission.context_hash,
          updated_at: mission.updated_at,
        })),
      },
      null,
      2,
    )
  }

  if (name === 'mission_get') {
    return JSON.stringify(await getMission(requireMissionId(args.mission_id)), null, 2)
  }

  if (name === 'mission_context_packet') {
    return JSON.stringify(await getMissionContextPacket(requireMissionId(args.mission_id)), null, 2)
  }

  return null
}
