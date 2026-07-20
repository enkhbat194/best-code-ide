import assert from 'node:assert/strict'
import test from 'node:test'

import { assertValidTaskGraph, buildAgentRuntimePlan } from './agentRuntime.ts'

const created = '2026-07-21T00:00:00.000Z'
const task = (task_id, overrides = {}) => ({
  task_id,
  title: task_id,
  priority: 'normal',
  status: 'pending',
  dependency_ids: [],
  created_at: created,
  ...overrides,
})

test('scheduler releases dependencies in priority order', () => {
  const plan = buildAgentRuntimePlan([
    task('architecture', { status: 'completed' }),
    task('security', { priority: 'high', dependency_ids: ['architecture'] }),
    task('implementation', { priority: 'critical', dependency_ids: ['architecture'] }),
    task('test', { dependency_ids: ['implementation'] }),
  ])

  assert.deepEqual(plan.ready.map((item) => item.task_id), ['implementation', 'security'])
  assert.deepEqual(plan.waiting.map((item) => item.task_id), ['test'])
  assert.deepEqual(plan.completed.map((item) => item.task_id), ['architecture'])
})

test('failed dependency blocks downstream work', () => {
  const plan = buildAgentRuntimePlan([
    task('build', { status: 'failed' }),
    task('deploy', { priority: 'critical', dependency_ids: ['build'] }),
  ])

  assert.equal(plan.blocked.length, 2)
  assert.match(plan.blocked.find((item) => item.task_id === 'deploy').blocked_reason, /dependency build is failed/)
})

test('graph rejects missing dependencies, self references, duplicates, and cycles', () => {
  assert.throws(() => assertValidTaskGraph([task('a', { dependency_ids: ['missing'] })]), /missing task/)
  assert.throws(() => assertValidTaskGraph([task('a', { dependency_ids: ['a'] })]), /cannot depend on itself/)
  assert.throws(() => assertValidTaskGraph([task('a'), task('a')]), /duplicate task_id/)
  assert.throws(() => assertValidTaskGraph([
    task('a', { dependency_ids: ['b'] }),
    task('b', { dependency_ids: ['a'] }),
  ]), /dependency cycle/)
})
