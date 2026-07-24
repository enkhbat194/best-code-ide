import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertExecutionGraph,
  assertExecutionTaskTransition,
  deterministicExecutionHash,
  executionTaskReadiness,
} from './missionExecutionSchema.ts'

const task = (task_id, dependencies = [], status = 'planned', mission_id = 'mission-a') => ({
  task_id, dependencies, status, mission_id,
})

test('execution hashes are deterministic across object key order', async () => {
  assert.equal(
    await deterministicExecutionHash({ b: 2, a: { d: 4, c: 3 } }),
    await deterministicExecutionHash({ a: { c: 3, d: 4 }, b: 2 }),
  )
})

test('execution task state machine fails closed', () => {
  assert.doesNotThrow(() => assertExecutionTaskTransition('ready', 'leased'))
  assert.doesNotThrow(() => assertExecutionTaskTransition('leased', 'running'))
  assert.throws(() => assertExecutionTaskTransition('planned', 'running'), /not allowed/)
  assert.throws(() => assertExecutionTaskTransition('failed', 'succeeded'), /not allowed/)
  assert.throws(() => assertExecutionTaskTransition('cancelled', 'ready'), /not allowed/)
})

test('dependency graph rejects missing, cross-Mission, and cyclic edges', () => {
  assert.doesNotThrow(() => assertExecutionGraph('mission-a', [task('a'), task('b', [{ task_id: 'a', kind: 'hard' }])]))
  assert.throws(() => assertExecutionGraph('mission-a', [task('a', [{ task_id: 'missing', kind: 'hard' }])]), /Missing dependency/)
  assert.throws(() => assertExecutionGraph('mission-a', [task('a', [], 'planned', 'mission-b')]), /Cross-Mission/)
  assert.throws(() => assertExecutionGraph('mission-a', [
    task('a', [{ task_id: 'b', kind: 'hard' }]),
    task('b', [{ task_id: 'a', kind: 'hard' }]),
  ]), /cycle/)
})

test('hard dependencies gate readiness while optional dependencies do not', () => {
  assert.equal(executionTaskReadiness(task('b', [{ task_id: 'a', kind: 'hard' }]), [task('a', [], 'failed')]), 'blocked')
  assert.equal(executionTaskReadiness(task('b', [{ task_id: 'a', kind: 'hard' }]), [task('a', [], 'succeeded')]), 'ready')
  assert.equal(executionTaskReadiness(task('b', [{ task_id: 'a', kind: 'optional' }]), [task('a', [], 'failed')]), 'ready')
})

