import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSecurityAuditEvent } from './securityAudit.ts'
import { normalizeSecurityAuditEvent } from './securityAuditStore.ts'

test('security audit event builder redacts secrets before persistence', () => {
  const event = buildSecurityAuditEvent('authorization_rejected', {
    path: '/api/tasks?key=owner-secret',
    method: 'POST',
    identity: 'unauthorized',
    authorization: 'Bearer abc.def',
    nested: { api_key: 'hidden' },
  })

  const serialized = JSON.stringify(event)
  assert.equal(serialized.includes('owner-secret'), false)
  assert.equal(serialized.includes('abc.def'), false)
  assert.equal(serialized.includes('hidden'), false)
  assert.equal(event.event, 'authorization_rejected')
  assert.equal(event.identity, 'unauthorized')
})

test('security audit store normalization rejects malformed records', () => {
  assert.equal(normalizeSecurityAuditEvent(null), null)
  assert.equal(normalizeSecurityAuditEvent({ audit_id: 'bad', event: 'x', occurred_at: 'nope' }), null)
})

test('security audit store normalization accepts bounded records', () => {
  const record = normalizeSecurityAuditEvent({
    audit_id: crypto.randomUUID(),
    event: 'rate_limit_rejected',
    occurred_at: '2026-07-21T00:00:00.000Z',
    path: '/api/tasks',
    method: 'GET',
    identity: 'owner',
    details: { limit: 600 },
  })

  assert.ok(record)
  assert.equal(record.event, 'rate_limit_rejected')
  assert.equal(record.identity, 'owner')
  assert.deepEqual(record.details, { limit: 600 })
})
