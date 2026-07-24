#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_BACKEND_URL = 'https://best-code-ide.enkhbat194.workers.dev'
const EXPECTED_AUDIT_EVENTS = [
  'mission_execution_plan_create',
  'mission_execution_plan_activate',
  'mission_task_lease_acquire',
  'mission_task_lease_heartbeat',
  'mission_task_progress_append',
  'mission_task_result_submit',
  'mission_task_block',
  'mission_task_retry',
  'mission_execution_approve_gate',
  'mission_execution_reject_gate',
  'mission_task_cancel',
  'mission_execution_cancel',
]

function boundedText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeRunKey(value) {
  const normalized = boundedText(value, 60).replace(/[^A-Za-z0-9_-]/g, '-')
  if (!normalized) throw new Error('Smoke run key is required')
  return normalized
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function deterministicId(runKey, label) {
  const hex = sha256(`${runKey}:${label}`).slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = '8'
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([key]) => key !== 'deterministic_hash' && key !== 'result_hash')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function deterministicHash(value) {
  return `sha256:${sha256(canonical(value))}`
}

function taskFixture({ taskId, projectId, missionId, planId, title, dependencies, approval, createdAt, runKey }) {
  return {
    schema_version: 'bestcode-execution-task-v1',
    task_id: taskId,
    project_id: projectId,
    mission_id: missionId,
    plan_id: planId,
    title,
    objective: `${title} in an isolated Chat 10 production smoke`,
    scope: [`smoke://${projectId}/${taskId}`],
    input_references: ['adr:BC-040', `smoke-run:${runKey}`],
    expected_output: 'Deterministic synthetic smoke evidence',
    done_criteria: ['The bounded runtime contract is verified without business-data access'],
    dependencies,
    status: 'planned',
    safety_class: approval ? 'approval-required' : 'read-only',
    preferred_agent_capabilities: ['test'],
    assigned_agent_id: null,
    lease_id: null,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 300,
    idempotency_key: `task-${sha256(`${runKey}:${taskId}`).slice(0, 24)}`,
    progress: 0,
    result: null,
    evidence_ids: [],
    blocker: null,
    approval_requirement: approval,
    created_at: createdAt,
    started_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    version: 1,
  }
}

export function buildSmokeFixtures(runKeyInput, createdAt = '2026-07-24T00:00:00.000Z') {
  const runKey = safeRunKey(runKeyInput)
  const projectId = `chat10-smoke-${sha256(runKey).slice(0, 16)}`
  const missionId = deterministicId(runKey, 'mission')
  const planId = deterministicId(runKey, 'plan')
  const taskIds = {
    foundation: deterministicId(runKey, 'task-foundation'),
    retry: deterministicId(runKey, 'task-retry'),
    approve: deterministicId(runKey, 'task-approve'),
    reject: deterministicId(runKey, 'task-reject'),
    cancel: deterministicId(runKey, 'task-cancel'),
  }
  const dependencies = {
    [taskIds.foundation]: [],
    [taskIds.retry]: [{ task_id: taskIds.foundation, kind: 'hard' }],
    [taskIds.approve]: [{ task_id: taskIds.retry, kind: 'hard' }],
    [taskIds.reject]: [{ task_id: taskIds.approve, kind: 'hard' }],
    [taskIds.cancel]: [{ task_id: taskIds.approve, kind: 'hard' }],
  }
  const tasks = [
    taskFixture({
      taskId: taskIds.foundation,
      projectId,
      missionId,
      planId,
      title: 'Foundation dependency task',
      dependencies: dependencies[taskIds.foundation],
      approval: null,
      createdAt,
      runKey,
    }),
    taskFixture({
      taskId: taskIds.retry,
      projectId,
      missionId,
      planId,
      title: 'Retry and handoff task',
      dependencies: dependencies[taskIds.retry],
      approval: null,
      createdAt,
      runKey,
    }),
    taskFixture({
      taskId: taskIds.approve,
      projectId,
      missionId,
      planId,
      title: 'Owner approval task',
      dependencies: dependencies[taskIds.approve],
      approval: 'production_mutation',
      createdAt,
      runKey,
    }),
    taskFixture({
      taskId: taskIds.reject,
      projectId,
      missionId,
      planId,
      title: 'Owner rejection task',
      dependencies: dependencies[taskIds.reject],
      approval: 'production_mutation',
      createdAt,
      runKey,
    }),
    taskFixture({
      taskId: taskIds.cancel,
      projectId,
      missionId,
      planId,
      title: 'Cancellation task',
      dependencies: dependencies[taskIds.cancel],
      approval: null,
      createdAt,
      runKey,
    }),
  ]
  const plan = {
    schema_version: 'bestcode-execution-plan-v1',
    plan_id: planId,
    project_id: projectId,
    mission_id: missionId,
    objective: `Chat 10 isolated production runtime smoke ${runKey}`,
    generated_from_context_version: 1,
    generated_from_context_hash: `sha256:${sha256(`context:${runKey}`)}`,
    planning_actor: 'chat10-smoke-planner',
    created_at: createdAt,
    status: 'draft',
    task_ids: tasks.map((task) => task.task_id),
    dependency_graph: dependencies,
    safety_constraints: [
      'isolated synthetic project only',
      'no repository write',
      'no subscription credential mutation',
      'no production business data access',
    ],
    approval_gates: ['production_mutation'],
    plan_version: 1,
    supersedes_plan_id: null,
    evidence_references: [`ev-chat10-plan-${sha256(runKey).slice(0, 16)}`],
    deterministic_hash: '',
  }
  plan.deterministic_hash = deterministicHash(plan)
  return { runKey, projectId, missionId, planId, taskIds, plan, tasks }
}

function sanitizedMessage(value, token) {
  let message = boundedText(value instanceof Error ? value.message : String(value), 500)
  if (token) message = message.split(token).join('[REDACTED]')
  return message
    .replace(/authorization/gi, '[REDACTED_HEADER]')
    .replace(/bearer\s+[^\s,;]+/gi, '[REDACTED_AUTH]')
    .slice(0, 500)
}

function errorCode(value) {
  return boundedText(value, 100)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'UNKNOWN_ERROR'
}

async function parseJson(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function resultFixture(runKey, label) {
  return {
    summary: `Completed isolated Chat 10 smoke step ${label}`,
    completed_work: [`synthetic-${label}`],
    changed_files: [],
    test_results: ['production runtime contract passed'],
    evidence_references: [`ev-chat10-${label}-${sha256(runKey).slice(0, 12)}`],
    unresolved_issues: [],
    deviations: [],
    decisions_required: [],
    suggested_next_action: 'Continue the isolated smoke plan',
  }
}

function activeLease(state, taskId) {
  return [...state.leases].reverse().find((lease) => lease.task_id === taskId && !lease.released_at)
}

function task(state, taskId) {
  return state.tasks.find((item) => item.task_id === taskId)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function assertEvidenceSafe(evidence, token) {
  const serialized = JSON.stringify(evidence)
  if (token && serialized.includes(token)) throw new Error('Evidence contains the production authentication secret')
  if (/authorization/i.test(serialized)) throw new Error('Evidence contains an authentication header name')
  if (/bearer\s/i.test(serialized)) throw new Error('Evidence contains a bearer credential marker')
  return true
}

export async function runProductionRuntimeSmoke(options) {
  const startedAt = new Date().toISOString()
  const fixtures = buildSmokeFixtures(options.runKey, startedAt)
  const baseUrl = boundedText(options.baseUrl, 300).replace(/\/$/, '')
  const token = boundedText(options.token, 4096)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const commandPath = `/api/mission-executions/${fixtures.missionId}/command`
  let missionCreated = false
  let executionCreated = false
  let state = null
  let stage = 'initialize'
  let failure = null
  const denials = {}
  const checks = {}
  const cleanup = {
    attempted: false,
    execution_cancelled: false,
    mission_cancelled: false,
    mission_lifecycle: null,
    errors: [],
  }

  const request = (path, init = {}) => fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  })

  const jsonRequest = async (label, path, init, expectedStatus) => {
    const response = await request(path, init)
    const body = await parseJson(response)
    if (response.status !== expectedStatus) {
      throw new Error(`${label} failed with HTTP ${response.status}: ${sanitizedMessage(body?.error ?? 'unexpected response', token)}`)
    }
    return body
  }

  const command = async (name, actorId, idempotencyKey, args = {}) => {
    const body = await jsonRequest(name, commandPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-BestCode-Agent-Id': actorId,
      },
      body: JSON.stringify({
        command: name,
        project_id: fixtures.projectId,
        expected_version: state?.version ?? 0,
        ...args,
      }),
    }, 200)
    state = body.state
    return body
  }

  const expectDenied = async (key, path, init, expectedPattern) => {
    const response = await request(path, init)
    const body = await parseJson(response)
    const message = sanitizedMessage(body?.error ?? '', token)
    assert(response.status >= 400 && response.status < 500, `${key} expected a fail-closed 4xx response, received ${response.status}`)
    assert(expectedPattern.test(message), `${key} returned an unexpected denial`)
    denials[key] = {
      denied: true,
      status: response.status,
      reason_code: errorCode(message),
    }
  }

  const deniedCommand = async (key, name, actorId, idempotencyKey, args, expectedPattern, overrides = {}) => {
    await expectDenied(key, commandPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-BestCode-Agent-Id': actorId,
      },
      body: JSON.stringify({
        command: name,
        project_id: fixtures.projectId,
        expected_version: state?.version ?? 0,
        ...args,
        ...overrides,
      }),
    }, expectedPattern)
  }

  try {
    assert(token, 'BESTCODE_AUTH_TOKEN is missing')
    assert(/^https:\/\//.test(baseUrl), 'Production backend URL must use HTTPS')

    stage = 'mission_create'
    const mission = await jsonRequest('mission create', '/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mission_id: fixtures.missionId,
        project_id: fixtures.projectId,
        title: `Chat 10 production runtime smoke ${fixtures.runKey}`,
      }),
    }, 201)
    missionCreated = true
    assert(mission.project_id === fixtures.projectId, 'Smoke Mission project scope mismatch')
    assert(mission.lifecycle === 'captured', 'Smoke Mission did not start captured')
    checks.isolated_mission_created = true

    stage = 'cross_project_denial'
    await expectDenied('cross_project_mutation', commandPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `deny-project-${sha256(fixtures.runKey).slice(0, 20)}`,
        'X-BestCode-Agent-Id': 'chat10-smoke-planner',
      },
      body: JSON.stringify({
        command: 'mission_execution_plan_create',
        project_id: `${fixtures.projectId}-wrong`,
        expected_version: 0,
        plan: fixtures.plan,
        tasks: fixtures.tasks,
      }),
    }, /cross-project/i)

    stage = 'cross_mission_denial'
    const crossMissionId = deterministicId(fixtures.runKey, 'cross-mission-denial')
    const crossMissionPlan = {
      ...fixtures.plan,
      mission_id: crossMissionId,
      deterministic_hash: '',
    }
    crossMissionPlan.deterministic_hash = deterministicHash(crossMissionPlan)
    await expectDenied('cross_mission_mutation', commandPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `deny-mission-${sha256(fixtures.runKey).slice(0, 20)}`,
        'X-BestCode-Agent-Id': 'chat10-smoke-planner',
      },
      body: JSON.stringify({
        command: 'mission_execution_plan_create',
        project_id: fixtures.projectId,
        expected_version: 0,
        plan: crossMissionPlan,
        tasks: fixtures.tasks,
      }),
    }, /scope|mission/i)

    stage = 'plan_create'
    await command(
      'mission_execution_plan_create',
      'chat10-smoke-planner',
      `plan-create-${sha256(fixtures.runKey).slice(0, 20)}`,
      { plan: fixtures.plan, tasks: fixtures.tasks },
    )
    executionCreated = true
    assert(state.version === 1 && state.tasks.length === 5, 'Execution plan/tasks were not created exactly once')
    checks.execution_plan_created = true
    checks.tasks_created = true

    stage = 'plan_activate'
    await command(
      'mission_execution_plan_activate',
      'chat10-smoke-planner',
      `plan-activate-${sha256(fixtures.runKey).slice(0, 18)}`,
      { plan_id: fixtures.planId },
    )
    assert(task(state, fixtures.taskIds.foundation).status === 'ready', 'Foundation task was not ready')
    for (const blockedId of [fixtures.taskIds.retry, fixtures.taskIds.approve, fixtures.taskIds.reject, fixtures.taskIds.cancel]) {
      assert(task(state, blockedId).status === 'blocked', 'A hard-dependent task became ready too early')
    }
    checks.plan_activated = true
    checks.hard_dependency_blocked = true

    stage = 'context_determinism'
    const contextPath = `/api/mission-executions/${fixtures.missionId}/context?task_id=${fixtures.taskIds.retry}`
    const contextOne = await jsonRequest('context packet first read', contextPath, {}, 200)
    const contextTwo = await jsonRequest('context packet repeated read', contextPath, {}, 200)
    assert(contextOne.deterministic_hash === contextTwo.deterministic_hash, 'Context packet hash is not deterministic')
    assert(contextOne.deterministic_hash === deterministicHash(contextOne), 'Context packet hash is invalid')
    checks.context_packet_deterministic = true

    stage = 'foundation_lease'
    await command(
      'mission_task_lease_acquire',
      'chat10-smoke-agent',
      `lease-foundation-${sha256(fixtures.runKey).slice(0, 16)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: deterministicId(fixtures.runKey, 'lease-foundation'),
        attempt_id: deterministicId(fixtures.runKey, 'attempt-foundation'),
        ttl_seconds: 300,
      },
    )
    let lease = activeLease(state, fixtures.taskIds.foundation)
    assert(lease?.fencing_token === 1, 'Foundation lease fencing token mismatch')
    checks.lease_acquired = true

    stage = 'foundation_heartbeat'
    await command(
      'mission_task_lease_heartbeat',
      'chat10-smoke-agent',
      `heartbeat-foundation-${sha256(fixtures.runKey).slice(0, 12)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        ttl_seconds: 300,
      },
    )
    checks.heartbeat_accepted = true

    stage = 'stale_lease_denial'
    await deniedCommand(
      'stale_lease_update',
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `deny-stale-${sha256(fixtures.runKey).slice(0, 18)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token + 1,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-stale-denied'),
          kind: 'started',
          message: 'This stale update must never persist',
        },
      },
      /stale|fencing/i,
    )
    checks.stale_lease_denied = true

    stage = 'identity_spoof_denial'
    await deniedCommand(
      'agent_provider_spoof',
      'mission_task_lease_heartbeat',
      'chat10-smoke-agent',
      `deny-spoof-${sha256(fixtures.runKey).slice(0, 18)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        agent_id: 'spoofed-agent',
        provider: 'spoofed-provider',
      },
      /spoof/i,
    )
    checks.identity_spoof_denied = true

    stage = 'foundation_progress'
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-foundation-${sha256(fixtures.runKey).slice(0, 12)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-foundation-started'),
          kind: 'started',
          message: 'Started isolated foundation task',
        },
      },
    )
    checks.progress_persisted = true

    stage = 'foundation_result'
    await command(
      'mission_task_result_submit',
      'chat10-smoke-agent',
      `result-foundation-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        result: resultFixture(fixtures.runKey, 'foundation'),
      },
    )
    assert(task(state, fixtures.taskIds.foundation).status === 'succeeded', 'Foundation result did not succeed')
    assert(task(state, fixtures.taskIds.foundation).evidence_ids.length === 1, 'Foundation result evidence was not stored')
    assert(task(state, fixtures.taskIds.retry).status === 'ready', 'Dependent retry task did not become ready')
    checks.evidence_result_accepted = true
    checks.dependency_became_ready = true

    stage = 'duplicate_result_denial'
    await deniedCommand(
      'duplicate_result',
      'mission_task_result_submit',
      'chat10-smoke-agent',
      `deny-duplicate-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.foundation,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        result: resultFixture(fixtures.runKey, 'duplicate'),
      },
      /lease|running|result/i,
    )
    checks.duplicate_result_denied = true

    stage = 'retry_first_attempt'
    await command(
      'mission_task_lease_acquire',
      'chat10-smoke-agent',
      `lease-retry-one-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.retry,
        lease_id: deterministicId(fixtures.runKey, 'lease-retry-one'),
        attempt_id: deterministicId(fixtures.runKey, 'attempt-retry-one'),
        ttl_seconds: 300,
      },
    )
    lease = activeLease(state, fixtures.taskIds.retry)
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-retry-one-${sha256(fixtures.runKey).slice(0, 12)}`,
      {
        task_id: fixtures.taskIds.retry,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-retry-one-started'),
          kind: 'started',
          message: 'Started retry-path first attempt',
        },
      },
    )
    await command(
      'mission_task_block',
      'chat10-smoke-agent',
      `block-retry-one-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.retry,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        blocker: {
          blocker_id: deterministicId(fixtures.runKey, 'blocker-retry-one'),
          code: 'test_failure',
          description: 'Synthetic retryable blocker for production contract verification',
          owner_action_required: false,
          retryable: true,
          evidence_ids: [`ev-chat10-blocker-${sha256(fixtures.runKey).slice(0, 12)}`],
        },
      },
    )
    const failedAttempt = state.attempts.find((attempt) => attempt.task_id === fixtures.taskIds.retry)
    assert(failedAttempt?.outcome === 'failed', 'Blocked attempt was not preserved as failed')
    assert(failedAttempt.handoff_packet?.deterministic_hash === deterministicHash(failedAttempt.handoff_packet), 'Handoff packet hash is invalid')
    checks.blocker_persisted = true
    checks.handoff_packet_deterministic = true

    stage = 'retry_second_attempt'
    await command(
      'mission_task_retry',
      'chat10-smoke-planner',
      `retry-task-${sha256(fixtures.runKey).slice(0, 18)}`,
      {
        task_id: fixtures.taskIds.retry,
        error_code: 'test_failure',
        retry_policy: {
          max_attempts: 3,
          retryable_error_codes: ['test_failure'],
          backoff_seconds: [0, 0],
          agent_strategy: 'same',
          context_refresh_required: true,
        },
      },
    )
    await command(
      'mission_task_lease_acquire',
      'chat10-smoke-agent',
      `lease-retry-two-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.retry,
        lease_id: deterministicId(fixtures.runKey, 'lease-retry-two'),
        attempt_id: deterministicId(fixtures.runKey, 'attempt-retry-two'),
        ttl_seconds: 300,
      },
    )
    lease = activeLease(state, fixtures.taskIds.retry)
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-retry-two-${sha256(fixtures.runKey).slice(0, 12)}`,
      {
        task_id: fixtures.taskIds.retry,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-retry-two-started'),
          kind: 'started',
          message: 'Started retry-path second attempt',
        },
      },
    )
    await command(
      'mission_task_result_submit',
      'chat10-smoke-agent',
      `result-retry-two-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.retry,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        result: resultFixture(fixtures.runKey, 'retry-second-attempt'),
      },
    )
    const retryAttempts = state.attempts.filter((attempt) => attempt.task_id === fixtures.taskIds.retry)
    assert(retryAttempts.length === 2, 'Retry attempt history was not preserved')
    assert(retryAttempts[0].outcome === 'failed' && retryAttempts[1].outcome === 'succeeded', 'Retry outcomes are invalid')
    assert(task(state, fixtures.taskIds.approve).status === 'ready', 'Approval task did not become ready')
    checks.retry_history_persisted = true

    stage = 'approval_gate'
    await command(
      'mission_task_lease_acquire',
      'chat10-smoke-agent',
      `lease-approve-${sha256(fixtures.runKey).slice(0, 16)}`,
      {
        task_id: fixtures.taskIds.approve,
        lease_id: deterministicId(fixtures.runKey, 'lease-approve'),
        attempt_id: deterministicId(fixtures.runKey, 'attempt-approve'),
        ttl_seconds: 300,
      },
    )
    lease = activeLease(state, fixtures.taskIds.approve)
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-approve-start-${sha256(fixtures.runKey).slice(0, 10)}`,
      {
        task_id: fixtures.taskIds.approve,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-approve-started'),
          kind: 'started',
          message: 'Started approval-gated synthetic task',
        },
      },
    )
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-approve-wait-${sha256(fixtures.runKey).slice(0, 12)}`,
      {
        task_id: fixtures.taskIds.approve,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-approve-waiting'),
          kind: 'waiting_for_approval',
          message: 'Waiting for explicit owner gate decision',
        },
      },
    )
    assert(task(state, fixtures.taskIds.approve).status === 'waiting_for_approval', 'Approval task did not stop at the gate')
    await deniedCommand(
      'unapproved_result',
      'mission_task_result_submit',
      'chat10-smoke-agent',
      `deny-unapproved-${sha256(fixtures.runKey).slice(0, 14)}`,
      {
        task_id: fixtures.taskIds.approve,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        result: resultFixture(fixtures.runKey, 'unapproved'),
      },
      /approval|running/i,
    )
    await command(
      'mission_execution_approve_gate',
      'owner',
      `owner-approve-${sha256(fixtures.runKey).slice(0, 16)}`,
      { task_id: fixtures.taskIds.approve },
    )
    assert(state.approval_gates[fixtures.taskIds.approve].actor === 'owner', 'Approval gate actor was not owner')
    await command(
      'mission_task_result_submit',
      'chat10-smoke-agent',
      `result-approve-${sha256(fixtures.runKey).slice(0, 16)}`,
      {
        task_id: fixtures.taskIds.approve,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        result: resultFixture(fixtures.runKey, 'owner-approved'),
      },
    )
    assert(task(state, fixtures.taskIds.approve).status === 'succeeded', 'Approved task did not succeed')
    assert(task(state, fixtures.taskIds.reject).status === 'ready', 'Rejection task did not become ready')
    assert(task(state, fixtures.taskIds.cancel).status === 'ready', 'Cancellation task did not become ready')
    checks.approval_gate_waited = true
    checks.owner_approval_accepted = true

    stage = 'rejection_gate'
    await command(
      'mission_task_lease_acquire',
      'chat10-smoke-agent',
      `lease-reject-${sha256(fixtures.runKey).slice(0, 16)}`,
      {
        task_id: fixtures.taskIds.reject,
        lease_id: deterministicId(fixtures.runKey, 'lease-reject'),
        attempt_id: deterministicId(fixtures.runKey, 'attempt-reject'),
        ttl_seconds: 300,
      },
    )
    lease = activeLease(state, fixtures.taskIds.reject)
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-reject-start-${sha256(fixtures.runKey).slice(0, 10)}`,
      {
        task_id: fixtures.taskIds.reject,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-reject-started'),
          kind: 'started',
          message: 'Started owner rejection contract task',
        },
      },
    )
    await command(
      'mission_task_progress_append',
      'chat10-smoke-agent',
      `progress-reject-wait-${sha256(fixtures.runKey).slice(0, 12)}`,
      {
        task_id: fixtures.taskIds.reject,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        event: {
          event_id: deterministicId(fixtures.runKey, 'event-reject-waiting'),
          kind: 'waiting_for_approval',
          message: 'Waiting for explicit owner rejection',
        },
      },
    )
    await command(
      'mission_execution_reject_gate',
      'owner',
      `owner-reject-${sha256(fixtures.runKey).slice(0, 18)}`,
      {
        task_id: fixtures.taskIds.reject,
        reason: 'Synthetic owner rejection for contract verification',
      },
    )
    assert(task(state, fixtures.taskIds.reject).status === 'failed', 'Rejected task did not fail closed')
    assert(state.approval_gates[fixtures.taskIds.reject].status === 'rejected', 'Owner rejection was not recorded')
    checks.owner_rejection_accepted = true

    stage = 'task_cancellation'
    await command(
      'mission_task_lease_acquire',
      'chat10-smoke-agent',
      `lease-cancel-${sha256(fixtures.runKey).slice(0, 16)}`,
      {
        task_id: fixtures.taskIds.cancel,
        lease_id: deterministicId(fixtures.runKey, 'lease-cancel'),
        attempt_id: deterministicId(fixtures.runKey, 'attempt-cancel'),
        ttl_seconds: 300,
      },
    )
    lease = activeLease(state, fixtures.taskIds.cancel)
    await command(
      'mission_task_cancel',
      'chat10-smoke-agent',
      `task-cancel-${sha256(fixtures.runKey).slice(0, 18)}`,
      {
        task_id: fixtures.taskIds.cancel,
        lease_id: lease.lease_id,
        fencing_token: lease.fencing_token,
        reason: 'Synthetic task cancellation',
      },
    )
    assert(task(state, fixtures.taskIds.cancel).status === 'cancelled', 'Task cancellation did not fail closed')
    checks.task_cancellation_accepted = true

    stage = 'execution_cancellation'
    await command(
      'mission_execution_cancel',
      'owner',
      `execution-cancel-${sha256(fixtures.runKey).slice(0, 14)}`,
      { reason: 'Chat 10 isolated production smoke complete' },
    )
    assert(state.cancelled_at, 'Execution cancellation timestamp is missing')
    assert(state.plans.every((plan) => plan.status === 'cancelled'), 'Execution plan did not close cancelled')
    cleanup.execution_cancelled = true

    stage = 'post_cancel_denial'
    await deniedCommand(
      'post_cancel_mutation',
      'mission_execution_plan_activate',
      'chat10-smoke-planner',
      `deny-post-cancel-${sha256(fixtures.runKey).slice(0, 12)}`,
      { plan_id: fixtures.planId },
      /cancelled/i,
    )
    checks.execution_cancellation_fail_closed = true

    stage = 'audit_verification'
    const persisted = await jsonRequest(
      'execution state read',
      `/api/mission-executions/${fixtures.missionId}`,
      {},
      200,
    )
    state = persisted
    const observedAuditEvents = new Set(state.audit_events.map((event) => event.event))
    for (const expected of EXPECTED_AUDIT_EVENTS) {
      assert(observedAuditEvents.has(expected), `Missing execution audit event ${expected}`)
    }
    assert(state.audit_events.every((event) => event.outcome === 'completed'), 'Execution audit contains an invalid outcome')
    checks.audit_events_complete = true
  } catch (error) {
    failure = {
      stage,
      code: errorCode(error instanceof Error ? error.message : error),
      message: sanitizedMessage(error, token),
    }
  } finally {
    cleanup.attempted = missionCreated
    if (missionCreated) {
      try {
        if (executionCreated && !state?.cancelled_at) {
          const current = await jsonRequest(
            'cleanup execution state read',
            `/api/mission-executions/${fixtures.missionId}`,
            {},
            200,
          )
          state = current
          if (!current.cancelled_at) {
            await command(
              'mission_execution_cancel',
              'owner',
              `cleanup-execution-${sha256(fixtures.runKey).slice(0, 13)}`,
              { reason: 'Fail-closed Chat 10 smoke cleanup' },
            )
          }
          cleanup.execution_cancelled = Boolean(state?.cancelled_at)
        }
      } catch (error) {
        cleanup.errors.push({
          stage: 'execution_cleanup',
          code: errorCode(error instanceof Error ? error.message : error),
        })
      }

      try {
        const currentMission = await jsonRequest(
          'cleanup Mission read',
          `/api/missions/${fixtures.missionId}`,
          {},
          200,
        )
        if (currentMission.lifecycle !== 'cancelled') {
          const cancelledMission = await jsonRequest(
            'cleanup Mission transition',
            `/api/missions/${fixtures.missionId}/transition`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                expected_context_version: currentMission.context_version,
                lifecycle: 'cancelled',
              }),
            },
            200,
          )
          cleanup.mission_lifecycle = cancelledMission.lifecycle
        } else {
          cleanup.mission_lifecycle = currentMission.lifecycle
        }
        cleanup.mission_cancelled = cleanup.mission_lifecycle === 'cancelled'
      } catch (error) {
        cleanup.errors.push({
          stage: 'mission_cleanup',
          code: errorCode(error instanceof Error ? error.message : error),
        })
      }
    }
  }

  const completedAt = new Date().toISOString()
  const auditEvents = state?.audit_events ?? []
  const evidence = {
    evidence_id: `ev_chat10_runtime_${fixtures.runKey}`,
    schema_version: 1,
    type: 'chat10_production_runtime_smoke',
    project_id: fixtures.projectId,
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/chat10-production-runtime-smoke.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      backend_url: baseUrl,
      run_key: fixtures.runKey,
      mission_id: fixtures.missionId,
      plan_id: fixtures.planId,
      task_ids: Object.values(fixtures.taskIds),
      isolated_project: true,
      production_business_data_accessed: false,
    },
    execution: {
      started_at: startedAt,
      completed_at: completedAt,
      conclusion: failure || !cleanup.mission_cancelled || cleanup.errors.length ? 'failure' : 'success',
      failure,
    },
    checks,
    denials,
    audit: {
      event_count: auditEvents.length,
      event_names: [...new Set(auditEvents.map((event) => event.event))].sort(),
      all_completed: auditEvents.every((event) => event.outcome === 'completed'),
      required_event_names: EXPECTED_AUDIT_EVENTS,
    },
    deterministic_hashes: {
      plan: fixtures.plan.deterministic_hash,
      context_packet_verified: checks.context_packet_deterministic === true,
      handoff_packet_verified: checks.handoff_packet_deterministic === true,
    },
    cleanup,
    security: {
      authentication_source: 'github-production-environment-secret',
      secret_name: 'BESTCODE_AUTH_TOKEN',
      redaction_applied: true,
      token_value_persisted: false,
      auth_header_persisted: false,
      browser_token_accessed: false,
      subscription_credential_created: false,
      subscription_mutation_profile_enabled: false,
    },
  }
  assertEvidenceSafe(evidence, token)
  return evidence
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`Unknown argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    args[key.slice(2)] = value
    index += 1
  }
  return args
}

async function writeEvidence(output, evidence) {
  const destination = resolve(output)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  return destination
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const token = boundedText(process.env.BESTCODE_AUTH_TOKEN, 4096)
  const baseUrl = boundedText(args['backend-url'] ?? process.env.BESTCODE_BACKEND_URL ?? DEFAULT_BACKEND_URL, 300)
  const runKey = boundedText(
    args['run-key'] ?? `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`,
    80,
  )
  const output = args.output ?? 'artifacts/chat10-production-runtime-smoke.json'
  if (!token) throw new Error('BESTCODE_AUTH_TOKEN is missing from the GitHub production environment')
  const evidence = await runProductionRuntimeSmoke({
    token,
    baseUrl,
    runKey,
    fetchImpl: globalThis.fetch,
  })
  const destination = await writeEvidence(output, evidence)
  console.log(`BestCode Chat 10 production runtime smoke: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${destination}`)
  if (evidence.execution.conclusion !== 'success') {
    throw new Error(`Chat 10 production runtime smoke failed closed at ${evidence.execution.failure?.stage ?? 'cleanup'}`)
  }
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(resolve(process.argv[1])).href

if (isEntryPoint) await runCli()
