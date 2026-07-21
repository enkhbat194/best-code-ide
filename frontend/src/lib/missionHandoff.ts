import { useSettingsStore } from '../store/settingsStore'
import type { MissionContextPacket } from './missionPacketClient'
import type { MissionNextAction } from './missionNextAction'

interface LlmResponse {
  message?: { content?: unknown } | null
  error?: string
}

export interface ProviderResumeCheck {
  ready: boolean
  summary: string
  nextAction: string
  missingContext: string[]
}

function parseCheck(content: string): ProviderResumeCheck {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Provider resume check structured JSON буцаасангүй.')
  let value: Record<string, unknown>
  try {
    value = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('Provider resume check JSON уншигдсангүй.')
  }
  const missingContext = Array.isArray(value.missing_context)
    ? value.missing_context.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 180)).filter(Boolean).slice(0, 6)
    : []
  if (typeof value.ready !== 'boolean' || typeof value.summary !== 'string' || typeof value.next_action !== 'string') {
    throw new Error('Provider resume check шаардлагатай field-үүд дутуу байна.')
  }
  return {
    ready: value.ready,
    summary: value.summary.trim().slice(0, 500),
    nextAction: value.next_action.trim().slice(0, 300),
    missingContext,
  }
}

export async function runDeepSeekResumeCheck(packet: MissionContextPacket, nextAction: MissionNextAction): Promise<ProviderResumeCheck> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new Error('Backend тохиргоо дутуу байна.')
  const response = await fetch(`${settings.backendUrl}/api/llm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.authToken}`,
    },
    body: JSON.stringify({
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            'You are verifying whether a provider-neutral BestCode Mission Context Packet is sufficient to resume work.',
            'Do not execute tools, repository writes, deployment, payment, or destructive actions.',
            'Return JSON only with keys: ready (boolean), summary (Mongolian Cyrillic), next_action (Mongolian Cyrillic), missing_context (array).',
            'ready may be true only when goal, done criteria, lifecycle, context version/hash and blocking decisions are understandable.',
            'Respect the supplied deterministic next-action policy and explicitly mention owner decision blocks.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({ packet, deterministic_next_action: nextAction }),
        },
      ],
    }),
  })
  const payload = await response.json().catch(() => null) as LlmResponse | null
  if (!response.ok) throw new Error(payload?.error || `DeepSeek resume check HTTP ${response.status} алдаатай.`)
  const content = payload?.message?.content
  if (typeof content !== 'string') throw new Error('DeepSeek resume check хоосон байна.')
  return parseCheck(content)
}
