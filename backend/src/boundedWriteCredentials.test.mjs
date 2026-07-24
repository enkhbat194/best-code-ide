import assert from 'node:assert/strict'
import test from 'node:test'

import {
  boundedWriteCredentialCreate,
  boundedWriteCredentialGet,
  boundedWriteCredentialRevoke,
  boundedWriteScopeHash,
} from './boundedWriteCredentials.ts'
import {
  BOUNDED_WRITE_PROFILE,
  DEFAULT_BOUNDED_WRITE_TTL_SECONDS,
} from './boundedWriteCredentialTypes.ts'
import { SecurityAuditStore } from './securityAuditStore.ts'
import { subscriptionToolNames } from './subscriptionTools.ts'

class MemoryStorage {
  constructor() { this.values = new Map() }
  async get(key) { return this.values.get(key) }
  async put(key, value) { this.values.set(key, structuredClone(value)) }
  async delete(keys) {
    let count = 0
    for (const key of Array.isArray(keys) ? keys : [keys]) if (this.values.delete(key)) count += 1
    return count
  }
  async list(options = {}) {
    let entries = [...this.values.entries()].filter(([key]) => key.startsWith(options.prefix ?? ''))
    entries.sort(([left], [right]) => left.localeCompare(right))
    if (options.reverse) entries.reverse()
    return new Map(entries.map(([key, value]) => [key, structuredClone(value)]))
  }
}

function environment() {
  const storage = new MemoryStorage()
  const durable = new SecurityAuditStore({ storage })
  return {
    storage,
    env: {
      PROJECTS_JSON: JSON.stringify([
        { id: 'bestcode', name: 'BestCode', owner: 'enkhbat194', repo: 'best-code-ide', defaultBranch: 'main' },
      ]),
      SECURITY_AUDIT: {
        idFromName: (name) => name,
        get: () => ({ fetch: (url, init) => durable.fetch(new Request(url, init)) }),
      },
    },
  }
}

const baseInput = {
  project_id: 'bestcode',
  mission_id: '11111111-1111-1111-1111-111111111111',
  execution_plan_id: '22222222-2222-2222-2222-222222222222',
  task_id: '33333333-3333-3333-3333-333333333333',
  attempt_id: '44444444-4444-4444-4444-444444444444',
  lease_id: '55555555-5555-5555-5555-555555555555',
  fencing_token: 7,
  agent_id: 'chatgpt-codex',
  provider: 'openai',
  branch: 'agent/chat11-smoke-abc123',
  base_sha: '554908b69fa855e2292a88357c67fc340e457370',
  allowed_tools: [...subscriptionToolNames, 'repository_create_branch', 'repository_write_file'],
  allowed_paths: ['docs/smoke/**'],
  limits: {
    max_operations: 20,
    max_changed_files: 1,
    max_total_changed_bytes: 4096,
    max_commits: 1,
    max_pushes: 1,
    max_pull_requests: 1,
  },
  idempotency_namespace: 'chat11-smoke-attempt-4444',
  approval_record_id: 'approval-chat11-smoke',
}

test('bounded write credential is fully bound, short-lived, and raw-secret-free at rest', async () => {
  const { env, storage } = environment()
  const issuedAt = '2026-07-24T06:00:00.000Z'
  const issued = await boundedWriteCredentialCreate(env, baseInput, issuedAt)

  assert.match(issued.secret, /^bcwrite_v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]+$/)
  assert.equal(issued.credential.profile, BOUNDED_WRITE_PROFILE)
  assert.equal(issued.credential.expires_at, new Date(Date.parse(issuedAt) + DEFAULT_BOUNDED_WRITE_TTL_SECONDS * 1000).toISOString())
  assert.equal(issued.credential.status, 'active')
  assert.equal(issued.credential.branch, baseInput.branch)
  assert.equal(issued.credential.fencing_token, 7)
  assert.equal(issued.credential.usage.operations, 0)
  assert.equal('secret_hash' in issued.credential, false)
  assert.ok(issued.credential.denied_paths.includes('.github/workflows/**'))

  const persisted = JSON.stringify([...storage.values.values()])
  assert.equal(persisted.includes(issued.secret), false)
  assert.equal(persisted.includes(issued.secret.split('.').at(-1)), false)
  assert.match(persisted, /"secret_hash":"[a-f0-9]{64}"/)

  const fetched = await boundedWriteCredentialGet(env, issued.credential.credential_id)
  assert.equal('secret_hash' in fetched, false)
  assert.deepEqual(fetched, issued.credential)
})

test('scope hash is deterministic and changes for any authoritative binding change', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput, '2026-07-24T06:00:00.000Z')
  const storedScope = {
    ...issued.credential,
  }
  delete storedScope.status
  delete storedScope.issued_at
  delete storedScope.expires_at
  delete storedScope.usage
  delete storedScope.scope_hash
  const expected = await boundedWriteScopeHash(storedScope)
  assert.equal(issued.credential.scope_hash, expected)
  assert.notEqual(expected, await boundedWriteScopeHash({ ...storedScope, task_id: 'different-task' }))
  assert.notEqual(expected, await boundedWriteScopeHash({ ...storedScope, branch: 'agent/other' }))
})

test('TTL above two hours and unsafe/invalid bindings fail closed', async () => {
  const { env } = environment()
  await assert.rejects(
    boundedWriteCredentialCreate(env, { ...baseInput, expires_in_seconds: 7_201 }),
    /between 300 and 7200/,
  )
  await assert.rejects(
    boundedWriteCredentialCreate(env, { ...baseInput, branch: 'main branch' }),
    /branch is invalid/,
  )
  await assert.rejects(
    boundedWriteCredentialCreate(env, { ...baseInput, limits: { ...baseInput.limits, max_pull_requests: 2 } }),
    /max_pull_requests is invalid/,
  )
})

test('owner-side revoke is idempotent and immediately changes public status', async () => {
  const { env } = environment()
  const issued = await boundedWriteCredentialCreate(env, baseInput)
  const first = await boundedWriteCredentialRevoke(env, issued.credential.credential_id)
  const second = await boundedWriteCredentialRevoke(env, issued.credential.credential_id)
  assert.equal(first.status, 'revoked')
  assert.equal(second.revoked_at, first.revoked_at)
})

test('read-only profile remains exact and independent from bounded write profile', () => {
  assert.equal(subscriptionToolNames.length, 12)
  assert.equal(new Set(subscriptionToolNames).size, 12)
  assert.equal(subscriptionToolNames.some((name) => /write|patch|commit|push|create_branch/.test(name)), false)
})
