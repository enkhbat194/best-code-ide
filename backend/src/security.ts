import { jsonError } from './utils'

export const DEFAULT_MAX_REQUEST_BYTES = 1_048_576
export const DEFAULT_CHAT_REQUEST_BYTES = 2_097_152
export const DEFAULT_FILE_REQUEST_BYTES = 5_242_880
export const DEFAULT_WORKSPACE_REQUEST_BYTES = 10_485_760
export const DEFAULT_ASSET_REQUEST_BYTES = 104_857_600
export const DEFAULT_RATE_LIMIT = 120
export const DEFAULT_OWNER_RATE_LIMIT = 600
export const DEFAULT_UNAUTHORIZED_RATE_LIMIT = 30
export const DEFAULT_RATE_WINDOW_MS = 60_000

const SENSITIVE_KEY = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|set-cookie|private[_-]?key)/i
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const QUERY_SECRET = /([?&](?:key|token|api_key|access_token|auth)=)[^&#\s]+/gi
const COMMON_SECRET = /\b(?:sk|rk|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g
const ASSET_CONTENT_PATH = /^\/api\/brain\/assets\/[A-Za-z0-9._:-]{3,64}\/content$/

export interface RequestLimitConfig {
  defaultBytes: number
  chatBytes: number
  fileBytes: number
  workspaceBytes: number
  assetBytes: number
}

export interface RateLimitProfile {
  owner: number
  unauthorized: number
  fallback: number
  windowMs: number
}

interface RateWindow {
  count: number
  resetAt: number
}

const rateWindows = new Map<string, RateWindow>()

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
  if (ASSET_CONTENT_PATH.test(url.pathname)) return config.assetBytes
  if (url.pathname === '/api/files/commit') return config.fileBytes
  if (url.pathname === '/api/workspace/export') return config.workspaceBytes
  return config.defaultBytes
}

export function rateLimitForIdentity(authorized: boolean, profile: RateLimitProfile): number {
  return authorized ? profile.owner : profile.unauthorized
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

export function clientRateKey(req: Request): string {
  const ip = req.headers.get('CF-Connecting-IP')?.trim()
  if (ip) return `ip:${ip}`
  const forwarded = req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  return forwarded ? `forwarded:${forwarded}` : 'anonymous'
}

export function enforceRateLimit(
  key: string,
  limit = DEFAULT_RATE_LIMIT,
  windowMs = DEFAULT_RATE_WINDOW_MS,
  now = Date.now(),
): Response | null {
  const current = rateWindows.get(key)
  const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current
  window.count += 1
  rateWindows.set(key, window)

  if (rateWindows.size > 10_000) {
    for (const [entryKey, entry] of rateWindows) {
      if (entry.resetAt <= now) rateWindows.delete(entryKey)
    }
  }

  if (window.count <= limit) return null
  const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000))
  const response = jsonError('Rate limit exceeded', 429)
  response.headers.set('Retry-After', String(retryAfter))
  response.headers.set('X-RateLimit-Limit', String(limit))
  response.headers.set('X-RateLimit-Remaining', '0')
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))
}

export function isOriginAllowed(origin: string | null, allowedOrigins: Set<string>): boolean {
  if (!origin) return true
  if (allowedOrigins.size === 0) return true
  return allowedOrigins.has(origin)
}

export function securityAudit(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    type: 'bestcode.security.audit',
    event,
    occurred_at: new Date().toISOString(),
    details: redactSensitive(details),
  }))
}
