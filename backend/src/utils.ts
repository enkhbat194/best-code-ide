export const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition, ETag, X-BestCode-Asset-Max-Bytes',
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  new Headers(CORS_HEADERS).forEach((value, name) => headers.set(name, value))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export function jsonError(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status)
}

/**
 * Looks up a secret by name, tolerating accidental whitespace/invisible
 * characters and case differences in the stored binding name.
 */
export function resolveSecret(env: unknown, name: string): string | undefined {
  const record = env as Record<string, unknown>
  const direct = record[name]
  if (typeof direct === 'string' && direct) return direct
  const target = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string' || !value) continue
    if (key.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === target) return value
  }
  return undefined
}
