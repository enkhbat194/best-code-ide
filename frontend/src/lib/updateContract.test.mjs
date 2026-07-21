import assert from 'node:assert/strict'
import test from 'node:test'

import { canAttemptSafeReload, evaluateVersionContract } from './updateContract.ts'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}

test('matching schema and SHA are current', () => {
  assert.deepEqual(evaluateVersionContract({ clientSchema: 1, backendSchema: 1, clientSha: 'abc', backendSha: 'abc', online: true }), {
    compatible: true,
    stale: false,
    state: 'current',
    reason: 'App болон backend нийцтэй, шинэчлэгдсэн байна.',
  })
})

test('schema mismatch is fail-closed and update available', () => {
  const result = evaluateVersionContract({ clientSchema: 1, backendSchema: 2, clientSha: 'abc', backendSha: 'def', online: true })
  assert.equal(result.compatible, false)
  assert.equal(result.state, 'available')
})

test('offline state does not force reload', () => {
  assert.equal(evaluateVersionContract({ clientSchema: 1, backendSchema: 1, online: false }).state, 'offline')
})

test('safe reload guard blocks rapid loop for the same target', () => {
  const storage = new MemoryStorage()
  assert.equal(canAttemptSafeReload(storage, 'target', 1000), true)
  assert.equal(canAttemptSafeReload(storage, 'target', 1001), false)
  assert.equal(canAttemptSafeReload(storage, 'target', 121001), true)
})
