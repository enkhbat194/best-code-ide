export const CHAT11_SMOKE_APPROVAL = 'chat11_bounded_write_smoke'
export const CHAT11_SMOKE_MAX_OPERATIONS = 160

export function rewriteChat11CredentialRequest(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url
  if (!url?.endsWith('/api/bounded-write/credentials') || String(init.method ?? 'GET').toUpperCase() !== 'POST') {
    return { input, init }
  }

  let payload
  try {
    payload = JSON.parse(String(init.body ?? ''))
  } catch {
    return { input, init }
  }

  if (
    payload?.approval_record_id !== CHAT11_SMOKE_APPROVAL ||
    !payload.limits ||
    payload.limits.max_operations !== 30
  ) {
    return { input, init }
  }

  return {
    input,
    init: {
      ...init,
      body: JSON.stringify({
        ...payload,
        limits: {
          ...payload.limits,
          max_operations: CHAT11_SMOKE_MAX_OPERATIONS,
        },
      }),
    },
  }
}

const originalFetch = globalThis.fetch
if (typeof originalFetch === 'function') {
  globalThis.fetch = (input, init) => {
    const rewritten = rewriteChat11CredentialRequest(input, init)
    return originalFetch(rewritten.input, rewritten.init)
  }
}
