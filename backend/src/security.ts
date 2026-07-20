import { jsonError } from './utils'

export const DEFAULT_MAX_REQUEST_BYTES = 1_048_576
export const DEFAULT_CHAT_REQUEST_BYTES = 2_097_152
export const DEFAULT_FILE_REQUEST_BYTES = 5_242_880
export const DEFAULT_WORKSPACE_REQUEST_BYTES = 10_485_760

const SENSITIVE_KEY = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|set-cookie|private[_-]?key)/i
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const QUERY_SECRET = /([?&](?:key|token|api_key|access_token|auth)=)[^&#\s]+/gi
const COMMON_SECRET = /\b(?:sk|rk|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g

export interface RequestLimitConfig {
  defaultBytes: number
  chatBytes: number
  fileBytes: number
  workspaceBytes: number
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function redactText(value: string): string {
  return value
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .replace(COMMON_SECRET, '[REDACTED]')
}

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen))

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, seen)
  }
  return output
}

export function requestLimitFor(url: URL, config: RequestLimitConfig): number {
  if (url.pathname === '/api/chat' || url.pathname === '/api/llm' || url.pathname === '/mcp') {
    return config.chatBytes
  }
  if (url.pathname === '/api/files/commit') return config.fileBytes
  if (url.pathname === '/api/workspace/export') return config.workspaceBytes
  return config.defaultBytes
}

export function enforceRequestLimits(req: Request, maxBytes = DEFAULT_MAX_REQUEST_BYTES): Response | null {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null

  const rawLength = req.headers.get('content-length')
  if (!rawLength) return null

  const length = Number(rawLength)
  if (!Number.isSafeInteger(length) || length < 0) {
    return jsonError('Invalid Content-Length header', 400)
  }
  if (length > maxBytes) {
    const response = jsonError(`Request body exceeds the ${maxBytes}-byte limit`, 413)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-BestCode-Request-Limit', String(maxBytes))
    return response
  }
  return null
}
