export const CLIENT_API_SCHEMA_VERSION = 1
export const UPDATE_RELOAD_GUARD_KEY = 'bestcode:update-reload-guard:v1'
export const UPDATE_RELOAD_GUARD_TTL_MS = 2 * 60 * 1000

export type UpdateState = 'current' | 'available' | 'ready' | 'applying' | 'failed' | 'offline'

export interface VersionContractInput {
  clientSchema: number
  backendSchema?: number | null
  clientSha?: string | null
  backendSha?: string | null
  online: boolean
}

export interface VersionContractResult {
  compatible: boolean
  stale: boolean
  state: UpdateState
  reason: string
}

export function evaluateVersionContract(input: VersionContractInput): VersionContractResult {
  if (!input.online) {
    return { compatible: true, stale: false, state: 'offline', reason: 'Сүлжээгүй байна. Хадгалсан app shell ашиглаж байна.' }
  }
  if (!Number.isInteger(input.backendSchema)) {
    return { compatible: false, stale: false, state: 'failed', reason: 'Backend schema version тодорхойгүй байна.' }
  }
  if (input.clientSchema !== input.backendSchema) {
    return { compatible: false, stale: true, state: 'available', reason: `API schema зөрүүтэй: app v${input.clientSchema}, backend v${input.backendSchema}.` }
  }
  const stale = Boolean(input.clientSha && input.backendSha && input.clientSha !== input.backendSha)
  return stale
    ? { compatible: true, stale: true, state: 'available', reason: 'Шинэ main хувилбар бэлэн байна.' }
    : { compatible: true, stale: false, state: 'current', reason: 'App болон backend нийцтэй, шинэчлэгдсэн байна.' }
}

export function canAttemptSafeReload(storage: Storage, targetSha: string, now = Date.now()): boolean {
  const raw = storage.getItem(UPDATE_RELOAD_GUARD_KEY)
  if (raw) {
    try {
      const previous = JSON.parse(raw) as { targetSha?: string; attemptedAt?: number }
      if (previous.targetSha === targetSha && typeof previous.attemptedAt === 'number' && now - previous.attemptedAt < UPDATE_RELOAD_GUARD_TTL_MS) {
        return false
      }
    } catch {
      storage.removeItem(UPDATE_RELOAD_GUARD_KEY)
    }
  }
  storage.setItem(UPDATE_RELOAD_GUARD_KEY, JSON.stringify({ targetSha, attemptedAt: now }))
  return true
}

export function clearSafeReloadGuard(storage: Storage): void {
  storage.removeItem(UPDATE_RELOAD_GUARD_KEY)
}
