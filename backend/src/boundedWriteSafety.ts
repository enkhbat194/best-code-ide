export interface BoundedWriteContentScan {
  scanned: boolean
  safe: boolean
  byte_length: number
  findings: string[]
}

const SECRET_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'bounded_write_credential', pattern: /\bbcwrite_v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{32,128}\b/i },
  { code: 'github_token', pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[opurs]_[A-Za-z0-9]{20,})\b/i },
  { code: 'model_provider_key', pattern: /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/i },
  { code: 'google_api_key', pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  { code: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i },
  { code: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i },
  { code: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i },
]

function patchAdditions(patch: string): string {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n')
}

export function normalizeBoundedRepositoryPath(value: string): string {
  const path = value.trim().replace(/^\/+/, '')
  if (!path || path.length > 240) throw new Error('INVALID_PATH')
  if (/[\u0000-\u001f\u007f\\]/.test(path)) throw new Error('INVALID_PATH')
  if (/%[a-f0-9]{2}/i.test(path)) throw new Error('ENCODED_PATH_DENIED')
  try {
    if (decodeURIComponent(path) !== path) throw new Error('ENCODED_PATH_DENIED')
  } catch (error) {
    if (error instanceof Error && error.message === 'ENCODED_PATH_DENIED') throw error
    throw new Error('ENCODED_PATH_DENIED')
  }
  if (path.normalize('NFKC') !== path) throw new Error('NON_CANONICAL_PATH_DENIED')
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('PATH_TRAVERSAL_DENIED')
  if (parts[0].toLowerCase() === '.git') throw new Error('PROTECTED_PATH_DENIED')
  return path
}

export function scanBoundedWriteContent(
  name: string,
  args: Record<string, unknown>,
): BoundedWriteContentScan {
  const raw = name === 'repository_write_file'
    ? args.content
    : name === 'repository_apply_patch'
      ? args.patch
      : undefined
  if (typeof raw !== 'string') {
    return { scanned: false, safe: true, byte_length: 0, findings: [] }
  }

  const inspected = name === 'repository_apply_patch' ? patchAdditions(raw) : raw
  const findings = SECRET_PATTERNS
    .filter(({ pattern }) => pattern.test(inspected))
    .map(({ code }) => `secret:${code}`)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(inspected)) findings.push('dangerous:binary_control')
  if (/[\u202a-\u202e\u2066-\u2069]/i.test(inspected)) findings.push('dangerous:bidi_control')

  return {
    scanned: true,
    safe: findings.length === 0,
    byte_length: new TextEncoder().encode(raw).byteLength,
    findings,
  }
}
