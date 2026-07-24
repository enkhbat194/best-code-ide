import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicExecutionHash } from './missionExecutionSchema.ts'
import { applyExecutionCommand, buildExecutionContextPacket, executionStatus } from './missionExecutionService.ts'

const projectId = 'bestcode'
const missionId = '11111111-1111-1111-1111-111111111111'
const planId = '22222222-2222-2222-2222-222222222222'
const taskId = '33333333-3333-3333-3333-333333333333'
const timestamp = '2026-07-24T00:00:00.000Z'

async function fixtures({ approval = null } = {}) {
  const task = {
    schema_version: 'bestcode-execution-task-v1',
    task_id: taskId,
    project_id: projectId,
    mission_id: missionId,
    plan_id: planId,
    title: 'Implement runtime',
    objective: 'Implement a bounded runtime',
    scope: ['backend/**'],
    input_references: ['ref-1'],
    expected_output: 'tested code',
    done_criteria: ['tests pass'],
    dependencies: [],
    status: 'planned',
    safety_class: approval ? 'approval-required' : 'read-only',
    preferred_agent_capabilities: ['test'],
    assigned_agent_id: null,
    lease_id: null,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 300,
    idempotency_key: 'task-key-00000001',
    progress: 0,
    result: null,
    evidence_ids: [],
    blocker: null,
    approval_requirement: approval,
    created_at: timestamp,
    started_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    version: 1,
  }
  const plan = {
    schema_version: 'bestcode-execution-plan-v1',
    plan_id: planId,
    project_id: projectId,
    mission_id: missionId,
    objective: 'Mission objective',
    generated_from_context_version: 1,
    generated_from_context_hash: 'sha256:context',
    planning_actor: 'planner-a',
    created_at: timestamp,
    status: 'draft',
    task_ids: [taskId],
    dependency_graph: { [taskId]: [] },
    safety_constraints: ['no production mutation'],
    approval_gates: approval ? [approval] : [],
    plan_version: 1,
    supersedes_plan_id: null,
    evidence_references: ['ev-plan'],
    deterministic_hash: '',
  }
  plan.deterministic_hash = await deterministicExecutionHash(plan)
  return { plan, tasks: [task] }
}

function command(name, args, key, actor = 'agent-a', expectedVersion) {
  return {
    command: name,
    project_id: projectId,
    mission_id: missionId,
    actor_id: actor,
    idempotency_key: key,
    ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion }),
    now: timestamp,
    args,
  }
}

async function activeState(options) {
  const seeded = await applyExecutionCommand(null, command(
    'mission_execution_plan_create',
    await fixtures(options),
    'create-plan-key-0001',
    'planner-a',
    0,
  ))
  return (await applyExecutionCommand(seeded.state, command(
    'mission_execution_plan_activate',
    { plan_id: planId },
    'activate-plan-key-01',
    'planner-a',
    1,
  ))).state
}

test('durable execution flow creates, activates, leases, progresses and accepts evidence result', async () => {
  let state = await activeState()
  let applied = await applyExecutionCommand(state, command('mission_task_lease_acquire', {
    task_id: taskId,
    lease_id: '44444444-4444-4444-4444-444444444444',
    attempt_id: '55555555-5555-5555-5555-555555555555',
    ttl_seconds: 60,
  }, 'lease-acquire-key-1', 'agent-a', 2))
  state = applied.state
  assert.equal(state.tasks[0].status, 'leased')
  assert.equal(state.attempts.length, 1)
  assert.equal(state.leases[0].fencing_token, 1)

  applied = await applyExecutionCommand(state, command('mission_task_progress_append', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    event: { event_id: '66666666-6666-6666-6666-666666666666', kind: 'started', message: 'Started' },
  }, 'progress-start-key-1', 'agent-a', 3))
  state = applied.state
  assert.equal(state.tasks[0].status, 'running')
  assert.equal(state.events.length, 1)

  const resultInput = {
    summary: 'Implemented',
    completed_work: ['runtime'],
    changed_files: ['backend/src/runtime.ts'],
    test_results: ['passed'],
    evidence_references: ['ev-test'],
    unresolved_issues: [],
    deviations: [],
    decisions_required: [],
    suggested_next_action: 'review',
  }
  state = (await applyExecutionCommand(state, command('mission_task_result_submit', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    result: resultInput,
  }, 'result-submit-key-1', 'agent-a', 4))).state
  assert.equal(state.tasks[0].status, 'succeeded')
  assert.equal(state.attempts[0].outcome, 'succeeded')
  assert.equal(state.leases[0].release_reason, 'result_submitted')
  assert.match(state.tasks[0].result.result_hash, /^sha256:/)
  assert.deepEqual(
    state.audit_events.map((event) => event.event),
    [
      'mission_execution_plan_create',
      'mission_execution_plan_activate',
      'mission_task_lease_acquire',
      'mission_task_progress_append',
      'mission_task_result_submit',
    ],
  )
  assert.equal(executionStatus(state).task_counts.succeeded, 1)
  assert.match((await buildExecutionContextPacket(state, taskId)).deterministic_hash, /^sha256:/)
})

test('idempotency replay is exact and stale versions, leases and identity spoof fail closed', async () => {
  const state = await activeState()
  const acquire = command('mission_task_lease_acquire', {
    task_id: taskId,
    lease_id: '44444444-4444-4444-4444-444444444444',
    attempt_id: '55555555-5555-5555-5555-555555555555',
  }, 'lease-acquire-key-1', 'agent-a', 2)
  const first = await applyExecutionCommand(state, acquire)
  const replay = await applyExecutionCommand(first.state, { ...acquire, expected_version: 3 })
  assert.equal(replay.replayed, true)
  assert.equal(replay.state.version, 3)
  await assert.rejects(applyExecutionCommand(first.state, command('mission_task_lease_heartbeat', {
    task_id: taskId,
    lease_id: first.state.leases[0].lease_id,
    fencing_token: 1,
  }, 'heartbeat-key-0001', 'agent-a', 2)), /version mismatch/)
  await assert.rejects(applyExecutionCommand(first.state, command('mission_task_lease_heartbeat', {
    task_id: taskId,
    agent_id: 'spoofed-agent',
    lease_id: first.state.leases[0].lease_id,
    fencing_token: 1,
  }, 'heartbeat-key-0002', 'agent-a', 3)), /spoof/)
  await assert.rejects(applyExecutionCommand(first.state, command('mission_task_lease_heartbeat', {
    task_id: taskId,
    provider: 'spoofed-provider',
    lease_id: first.state.leases[0].lease_id,
    fencing_token: 1,
  }, 'heartbeat-key-0003', 'agent-a', 3)), /Provider identity spoof/)
})

test('approval-required result is blocked until an owner-only gate command approves it', async () => {
  let state = await activeState({ approval: 'merge' })
  state = (await applyExecutionCommand(state, command('mission_task_lease_acquire', {
    task_id: taskId,
    lease_id: '44444444-4444-4444-4444-444444444444',
    attempt_id: '55555555-5555-5555-5555-555555555555',
  }, 'lease-acquire-key-1', 'agent-a', 2))).state
  state = (await applyExecutionCommand(state, command('mission_task_progress_append', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    event: { event_id: '66666666-6666-6666-6666-666666666666', kind: 'started', message: 'Started' },
  }, 'progress-start-key-1', 'agent-a', 3))).state
  state = (await applyExecutionCommand(state, command('mission_task_progress_append', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    event: { event_id: '77777777-7777-7777-7777-777777777777', kind: 'waiting_for_approval', message: 'Ready for approval' },
  }, 'progress-approval-01', 'agent-a', 4))).state
  assert.equal(state.tasks[0].status, 'waiting_for_approval')
  const resultArgs = {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    result: { summary: 'Done', completed_work: ['work'], changed_files: [], test_results: ['pass'], evidence_references: ['ev-1'], unresolved_issues: [], deviations: [], decisions_required: [], suggested_next_action: 'merge' },
  }
  await assert.rejects(applyExecutionCommand(state, command('mission_task_result_submit', resultArgs, 'result-submit-key-1', 'agent-a', 5)), /running/)
  state = (await applyExecutionCommand(state, command('mission_execution_approve_gate', { task_id: taskId }, 'owner-approve-key-1', 'owner', 5))).state
  assert.equal(state.approval_gates[taskId].actor, 'owner')
  assert.equal(state.tasks[0].status, 'running')
  state = (await applyExecutionCommand(state, command('mission_task_result_submit', resultArgs, 'result-submit-key-2', 'agent-a', 6))).state
  assert.equal(state.tasks[0].status, 'succeeded')
})

test('cross-scope commands and invalid plan hashes are denied', async () => {
  const data = await fixtures()
  await assert.rejects(applyExecutionCommand(null, {
    ...command('mission_execution_plan_create', data, 'create-plan-key-0001', 'planner-a', 0),
    project_id: 'wrong-project',
  }), /scope mismatch/)
  data.plan.deterministic_hash = 'sha256:tampered'
  await assert.rejects(applyExecutionCommand(null, command('mission_execution_plan_create', data, 'create-plan-key-0002', 'planner-a', 0)), /hash mismatch/)

  const invalidTask = await fixtures()
  invalidTask.tasks[0].status = 'ready'
  await assert.rejects(applyExecutionCommand(null, command(
    'mission_execution_plan_create',
    invalidTask,
    'create-plan-key-0003',
    'planner-a',
    0,
  )), /must start unassigned/)

  const mismatchedGraph = await fixtures()
  mismatchedGraph.plan.dependency_graph[taskId] = [{ task_id: taskId, kind: 'optional' }]
  mismatchedGraph.plan.deterministic_hash = await deterministicExecutionHash(mismatchedGraph.plan)
  await assert.rejects(applyExecutionCommand(null, command(
    'mission_execution_plan_create',
    mismatchedGraph,
    'create-plan-key-0004',
    'planner-a',
    0,
  )), /dependency graph mismatch/)
})

test('blocking a leased task closes the immutable attempt with a deterministic handoff', async () => {
  let state = await activeState()
  state = (await applyExecutionCommand(state, command('mission_task_lease_acquire', {
    task_id: taskId,
    lease_id: '44444444-4444-4444-4444-444444444444',
    attempt_id: '55555555-5555-5555-5555-555555555555',
  }, 'lease-acquire-key-1', 'agent-a', 2))).state
  state = (await applyExecutionCommand(state, command('mission_task_block', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    blocker: {
      blocker_id: '88888888-8888-4888-8888-888888888888',
      code: 'test_failure',
      description: 'A deterministic failure',
      owner_action_required: false,
      retryable: true,
      evidence_ids: ['ev-failure'],
    },
  }, 'block-task-key-0001', 'agent-a', 3))).state
  const handoff = state.attempts[0].handoff_packet
  assert.equal(state.tasks[0].status, 'blocked')
  assert.equal(state.attempts[0].outcome, 'failed')
  assert.equal(handoff.execution_plan_id, planId)
  assert.equal(
    handoff.deterministic_hash,
    await deterministicExecutionHash(handoff),
  )
})

test('owner rejection closes leased work and execution cancellation preserves terminal history', async () => {
  let state = await activeState({ approval: 'deploy' })
  state = (await applyExecutionCommand(state, command('mission_task_lease_acquire', {
    task_id: taskId,
    lease_id: '44444444-4444-4444-4444-444444444444',
    attempt_id: '55555555-5555-5555-5555-555555555555',
  }, 'lease-acquire-key-1', 'agent-a', 2))).state
  state = (await applyExecutionCommand(state, command('mission_task_progress_append', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    event: { event_id: '66666666-6666-6666-6666-666666666666', kind: 'started', message: 'Started' },
  }, 'progress-start-key-1', 'agent-a', 3))).state
  state = (await applyExecutionCommand(state, command('mission_task_progress_append', {
    task_id: taskId,
    lease_id: state.leases[0].lease_id,
    fencing_token: 1,
    event: { event_id: '77777777-7777-7777-7777-777777777777', kind: 'waiting_for_approval', message: 'Waiting' },
  }, 'progress-approval-01', 'agent-a', 4))).state
  state = (await applyExecutionCommand(state, command(
    'mission_execution_reject_gate',
    { task_id: taskId, reason: 'Owner declined production mutation' },
    'owner-reject-key-01',
    'owner',
    5,
  ))).state
  assert.equal(state.tasks[0].status, 'failed')
  assert.equal(state.leases[0].release_reason, 'approval_rejected')
  assert.equal(state.attempts[0].error_code, 'APPROVAL_DENIED')

  state = (await applyExecutionCommand(state, command(
    'mission_execution_cancel',
    {},
    'execution-cancel-01',
    'owner',
    6,
  ))).state
  assert.equal(state.plans[0].status, 'cancelled')
  assert.equal(state.tasks[0].status, 'failed')
  assert.equal(state.cancelled_at, timestamp)
})
