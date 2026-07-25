import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHAT11_SMOKE_MAX_OPERATIONS,
  rewriteChat11CredentialRequest,
} from './chat11-bounded-write-operation-budget.mjs'

const endpoint = 'https://bestcode.example/api/bounded-write/credentials'

function request(overrides = {}) {
  return {
    method: 'POST',
    body: JSON.stringify({
      approval_record_id: 'chat11_bounded_write_smoke',
      limits: {
        max_operations: 30,
        max_changed_files: 1,
        max_total_changed_bytes: 4096,
        max_commits: 1,
        max_pushes: 1,
        max_pull_requests: 1,
      },
      ...overrides,
    }),
  }
}

test('raises only the Chat 11 smoke operation budget needed for bounded CI polling', () => {
  const rewritten = rewriteChat11CredentialRequest(endpoint, request())
  const payload = JSON.parse(rewritten.init.body)
  assert.equal(payload.limits.max_operations, CHAT11_SMOKE_MAX_OPERATIONS)
  assert.equal(payload.limits.max_changed_files, 1)
  assert.equal(payload.limits.max_commits, 1)
  assert.equal(payload.limits.max_pushes, 1)
  assert.equal(payload.limits.max_pull_requests, 1)
})

test('does not broaden another approval or an explicitly different operation budget', () => {
  const otherApproval = request({ approval_record_id: 'another_approval' })
  assert.strictEqual(rewriteChat11CredentialRequest(endpoint, otherApproval).init, otherApproval)

  const explicitBudget = request({
    limits: {
      ...JSON.parse(request().body).limits,
      max_operations: 45,
    },
  })
  assert.strictEqual(rewriteChat11CredentialRequest(endpoint, explicitBudget).init, explicitBudget)
})

test('does not rewrite unrelated requests', () => {
  const init = request()
  assert.strictEqual(rewriteChat11CredentialRequest('https://bestcode.example/api/missions', init).init, init)
  assert.strictEqual(rewriteChat11CredentialRequest(endpoint, { ...init, method: 'GET' }).init.method, 'GET')
})
