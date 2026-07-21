import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertMissionLifecycleTransition,
  assertValidMissionGraph,
  assertWriterLeaseAvailable,
  computeMissionContextHash,
  isTerminalMissionLifecycle,
} from './missionSchema.ts'

const now = '2026-07-21T00:00:00.000Z'
const task = (task_id, overrides = {}) => ({
  task_id,
  title: task_id,
  priority: 'normal',
  status: 'pending',
  dependency_ids: [],
  operation_ids: [],
  assigned_agent_id: null,
  created_at: now,
  updated_at: now,
  ...overrides,
})

test('mission lifecycle permits bounded forward, pause, recovery, and package transitions', () => {
  assert.doesNotThrow(() => assertMissionLifecycleTransition('captured', 'framing'))
  assert.doesNotThrow(() => assertMissionLifecycleTransition('executing', 'paused'))
  assert.doesNotThrow(() => assertMissionLifecycleTransition('paused', 'executing'))
  assert.doesNotThrow(() => assertMissionLifecycleTransition('completed', 'packaged'))
  assert.throws(() => assertMissionLifecycleTransition('packaged', 'executing'), /not allowed/)
  assert.throws(() => assertMissionLifecycleTransition('captured', 'completed'), /not allowed/)
  assert.equal(isTerminalMissionLifecycle('packaged'), true)
  assert.equal(isTerminalMissionLifecycle('executing'), false)
})

test('mission task graph rejects duplicate, missing, self, and cyclic dependencies', () => {
  assert.doesNotThrow(() => assertValidMissionGraph([
    task('architecture'),
    task('implementation', { dependency_ids: ['architecture'] }),
    task('verification', { dependency_ids: ['implementation'] }),
  ]))
  assert.throws(() => assertValidMissionGraph([task('a'), task('a')]), /duplicate/)
  assert.throws(() => assertValidMissionGraph([task('a', { dependency_ids: ['missing'] })]), /missing/)
  assert.throws(() => assertValidMissionGraph([task('a', { dependency_ids: ['a'] })]), /itself/)
  assert.throws(() => assertValidMissionGraph([
    task('a', { dependency_ids: ['b'] }),
    task('b', { dependency_ids: ['a'] }),
  ]), /cycle/)
})

test('context hash is deterministic and insensitive to identifier ordering', () => {
  const base = {
    mission_id: 'mission-1',
    project_id: 'bestcode',
    lifecycle: 'planned',
    context_version: 3,
    goal_ids: ['goal-b', 'goal-a'],
    task_ids: ['task-b', 'task-a'],
    decision_ids: ['decision-b', 'decision-a'],
  }
  const left = computeMissionContextHash(base)
  const right = computeMissionContextHash({
    ...base,
    goal_ids: [...base.goal_ids].reverse(),
    task_ids: [...base.task_ids].reverse(),
    decision_ids: [...base.decision_ids].reverse(),
  })
  assert.equal(left, right)
  assert.match(left, /^fnv1a32:[a-f0-9]{8}$/)
  assert.notEqual(left, computeMissionContextHash({ ...base, context_version: 4 }))
})

test('writer lease allows same holder or expired lease and blocks another active writer', () => {
  const lease = {
    lease_id: 'lease-1',
    holder_id: 'chatgpt',
    acquired_at: '2026-07-21T00:00:00.000Z',
    heartbeat_at: '2026-07-21T00:00:10.000Z',
    expires_at: '2026-07-21T00:01:00.000Z',
    context_version: 2,
  }
  assert.doesNotThrow(() => assertWriterLeaseAvailable(null, 'claude', new Date('2026-07-21T00:00:30.000Z')))
  assert.doesNotThrow(() => assertWriterLeaseAvailable(lease, 'chatgpt', new Date('2026-07-21T00:00:30.000Z')))
  assert.doesNotThrow(() => assertWriterLeaseAvailable(lease, 'claude', new Date('2026-07-21T00:01:01.000Z')))
  assert.throws(
    () => assertWriterLeaseAvailable(lease, 'claude', new Date('2026-07-21T00:00:30.000Z')),
    /held by chatgpt/,
  )
})
