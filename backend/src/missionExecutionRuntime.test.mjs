import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acquireTaskLease, appendProgress, assertActiveLease, assertAgentAssignment,
  assertOwnerApprovalGate, assertTaskResult, buildTaskResult, cancelTask,
  heartbeatTaskLease, refreshReadyTasks, retryTask,
} from './missionExecutionRuntime.ts'

const baseTask = (overrides = {}) => ({
  schema_version: 'bestcode-execution-task-v1', task_id: 'task-a', project_id: 'bestcode',
  mission_id: 'mission-a', plan_id: 'plan-a', title: 'Task', objective: 'Do it', scope: [],
  input_references: [], expected_output: 'result', done_criteria: ['test'], dependencies: [],
  status: 'ready', safety_class: 'read-only', preferred_agent_capabilities: [],
  assigned_agent_id: null, lease_id: null, attempt_count: 0, max_attempts: 3,
  timeout_seconds: 300, idempotency_key: 'idempotency-key-0001', progress: 0, result: null,
  evidence_ids: [], blocker: null, approval_requirement: null,
  created_at: '2026-07-24T00:00:00.000Z', started_at: null, completed_at: null,
  failed_at: null, cancelled_at: null, version: 1, ...overrides,
})

test('lease acquisition, duplicate denial, heartbeat, expiry and fencing fail closed', () => {
  const now = new Date('2026-07-24T00:00:00.000Z')
  const lease = acquireTaskLease({ task: baseTask(), current: null, agentId: 'agent-a', leaseId: 'lease-a', attemptId: 'attempt-a', now, ttlSeconds: 60 })
  assert.equal(lease.fencing_token, 1)
  assert.throws(() => acquireTaskLease({ task: baseTask(), current: lease, agentId: 'agent-b', leaseId: 'lease-b', attemptId: 'attempt-b', now, ttlSeconds: 60 }), /active lease/)
  assert.equal(heartbeatTaskLease(lease, new Date('2026-07-24T00:00:30.000Z'), 60, 1).heartbeat_at, '2026-07-24T00:00:30.000Z')
  assert.throws(() => assertActiveLease(lease, { ...lease, fencing_token: 0 }, now), /Stale fencing/)
  assert.throws(() => assertActiveLease(lease, lease, new Date('2026-07-24T00:02:00.000Z')), /expired/)
  const takeover = acquireTaskLease({ task: baseTask(), current: lease, agentId: 'agent-b', leaseId: 'lease-b', attemptId: 'attempt-b', now: new Date('2026-07-24T00:02:00.000Z'), ttlSeconds: 60 })
  assert.equal(takeover.fencing_token, 2)
})

test('progress is append-only and stale agents cannot update', () => {
  const now = new Date('2026-07-24T00:00:00.000Z')
  const lease = acquireTaskLease({ task: baseTask(), current: null, agentId: 'agent-a', leaseId: 'lease-a', attemptId: 'attempt-a', now, ttlSeconds: 60 })
  const event = { event_id: 'event-a', project_id: 'bestcode', mission_id: 'mission-a', task_id: 'task-a', attempt_id: 'attempt-a', lease_id: 'lease-a', agent_id: 'agent-a', kind: 'started', message: 'Started', created_at: now.toISOString(), fencing_token: 1 }
  assert.equal(appendProgress([], event, lease, now).length, 1)
  assert.throws(() => appendProgress([event], event, lease, now), /Duplicate/)
  assert.throws(() => appendProgress([], { ...event, agent_id: 'spoofed' }, lease, now), /agent_id mismatch/)
})

test('capability and safety profiles prevent provider or identity based escalation', () => {
  const agent = { agent_id: 'agent-a', provider: 'anything', capabilities: ['repository-read'], safety_classes: ['read-only'], project_ids: ['bestcode'], enabled: true }
  assert.doesNotThrow(() => assertAgentAssignment(baseTask(), agent, ['repository-read']))
  assert.throws(() => assertAgentAssignment(baseTask({ safety_class: 'approval-required' }), agent, ['repository-write']), /safety profile/)
})

test('owner-only gates cannot be satisfied by agent claims', () => {
  assert.throws(() => assertOwnerApprovalGate('deploy', { status: 'approved', actor: 'agent-a' }), /Owner approval/)
  assert.doesNotThrow(() => assertOwnerApprovalGate('deploy', { status: 'approved', actor: 'owner' }))
})

test('results require evidence, hash deterministically, and reject tampering', async () => {
  const input = { summary: 'Done', completed_work: ['work'], changed_files: [], test_results: ['pass'], evidence_references: ['ev-1'], unresolved_issues: [], deviations: [], decisions_required: [], suggested_next_action: 'review' }
  const result = await buildTaskResult(input)
  await assert.doesNotReject(assertTaskResult(result))
  await assert.rejects(assertTaskResult({ ...result, summary: 'tampered' }), /hash mismatch/)
  await assert.rejects(buildTaskResult({ ...input, evidence_references: [] }), /requires/)
})

test('dependency completion opens tasks and failed hard dependencies stay blocked', () => {
  const root = baseTask({ task_id: 'root', status: 'succeeded' })
  const downstream = baseTask({ task_id: 'next', status: 'blocked', dependencies: [{ task_id: 'root', kind: 'hard' }] })
  assert.equal(refreshReadyTasks([root, downstream])[1].status, 'ready')
  assert.equal(refreshReadyTasks([{ ...root, status: 'failed' }, downstream])[1].status, 'blocked')
})

test('retry, max attempts, blind denial retry and cancellation are enforced', () => {
  const policy = { max_attempts: 3, retryable_error_codes: ['TEST_FAILURE', 'PERMISSION_DENIED'], backoff_seconds: [1], agent_strategy: 'same', context_refresh_required: true }
  assert.equal(retryTask(baseTask({ status: 'failed', attempt_count: 1 }), 'TEST_FAILURE', policy).status, 'ready')
  assert.throws(() => retryTask(baseTask({ status: 'failed', attempt_count: 3 }), 'TEST_FAILURE', policy), /Maximum/)
  assert.throws(() => retryTask(baseTask({ status: 'failed' }), 'PERMISSION_DENIED', policy), /blindly/)
  assert.equal(cancelTask(baseTask({ status: 'running' })).status, 'cancelled')
  assert.throws(() => cancelTask(baseTask({ status: 'succeeded' })), /not allowed/)
})

