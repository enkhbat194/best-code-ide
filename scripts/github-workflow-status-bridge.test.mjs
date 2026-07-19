import assert from 'node:assert/strict'
import test from 'node:test'

import { selectExpectedRun, statusState } from './github-workflow-status-bridge.mjs'

test('selects only the completed push run for the exact rehearsal SHA', () => {
  const expectedSha = 'a'.repeat(40)
  const selected = selectExpectedRun([
    { id: 3, head_sha: 'b'.repeat(40), event: 'push', status: 'completed', conclusion: 'success' },
    { id: 2, head_sha: expectedSha, event: 'push', status: 'in_progress', conclusion: null },
    { id: 1, head_sha: expectedSha, event: 'push', status: 'completed', conclusion: 'success' },
  ], expectedSha)

  assert.equal(selected?.id, 1)
  assert.equal(selectExpectedRun([], expectedSha), null)
})

test('maps only a successful run to a successful commit status', () => {
  assert.equal(statusState('success'), 'success')
  assert.equal(statusState('failure'), 'failure')
  assert.equal(statusState('cancelled'), 'failure')
})
