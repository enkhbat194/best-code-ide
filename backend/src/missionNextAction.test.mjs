import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveMissionNextAction } from '../../frontend/src/lib/missionNextAction.ts'

const now = '2026-07-21T00:00:00.000Z'
const baseMission = (overrides = {}) => ({
  mission_id: '11111111-1111-4111-8111-111111111111',
  project_id: 'bestcode',
  title: 'Mission',
  lifecycle: 'planned',
  goals: [{ goal_id: '22222222-2222-4222-8222-222222222222', title: 'Goal', outcome: 'Outcome', created_at: now }],
  acceptance_criteria: [{ criterion_id: '33333333-3333-4333-8333-333333333333', statement: 'Works', status: 'pending', evidence_ids: [] }],
  decisions: [],
  tasks: [],
  operations: [],
  writer_lease: null,
  context_version: 3,
  context_hash: 'fnv1a32:00000000',
  created_at: now,
  updated_at: now,
  ...overrides,
})

const task = (overrides = {}) => ({
  task_id: '44444444-4444-4444-8444-444444444444',
  title: 'Implement UI',
  priority: 'high',
  status: 'ready',
  dependency_ids: [],
  operation_ids: [],
  assigned_agent_id: null,
  created_at: now,
  updated_at: now,
  ...overrides,
})

test('open owner decision blocks autonomous continuation', () => {
  const action = deriveMissionNextAction(baseMission({
    decisions: [{ decision_id: '55555555-5555-4555-8555-555555555555', title: 'Choose scope', status: 'open', rationale: 'Owner choice', decided_at: null }],
  }))
  assert.equal(action.kind, 'owner_decision')
  assert.equal(action.blocked, true)
  assert.equal(action.ownerRequired, true)
})

test('active writer lease blocks a second writer', () => {
  const action = deriveMissionNextAction(baseMission({
    writer_lease: {
      lease_id: '66666666-6666-4666-8666-666666666666',
      holder_id: 'claude',
      acquired_at: now,
      heartbeat_at: now,
      expires_at: '2026-07-21T00:10:00.000Z',
      context_version: 4,
    },
  }), Date.parse('2026-07-21T00:05:00.000Z'))
  assert.equal(action.kind, 'wait_for_writer')
  assert.equal(action.blocked, true)
})

test('highest-priority dependency-ready task is selected', () => {
  const action = deriveMissionNextAction(baseMission({
    tasks: [
      task({ task_id: '77777777-7777-4777-8777-777777777777', title: 'Low', priority: 'low' }),
      task({ task_id: '88888888-8888-4888-8888-888888888888', title: 'Critical', priority: 'critical' }),
    ],
  }))
  assert.equal(action.kind, 'continue_task')
  assert.equal(action.title, 'Critical')
})

test('goal without criteria requires owner done contract', () => {
  const action = deriveMissionNextAction(baseMission({ acceptance_criteria: [] }))
  assert.equal(action.kind, 'define_done_contract')
  assert.equal(action.ownerRequired, true)
})
