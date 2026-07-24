import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalStore } from './approvalStore.ts'
import { handleMissionApi } from './missionApi.ts'
import { handleMissionExecutionApi } from './missionExecutionApi.ts'
import { deterministicExecutionHash } from './missionExecutionSchema.ts'
import { executeMissionExecutionTool } from './missionExecutionTools.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, value)
  }

  async list(options = {}) {
    const prefix = options.prefix ?? ''
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)))
  }

  async transaction(callback) {
    return callback(this)
  }
}

function testEnv() {
  const store = new ApprovalStore({ storage: new MemoryStorage() })
  const stub = { fetch: (input, init) => store.fetch(input instanceof Request ? input : new Request(input, init)) }
  return { APPROVALS: { idFromName(name) { return name }, get() { return stub } } }
}

const projectId = 'bestcode'
const missionId = '11111111-1111-4111-8111-111111111111'
const planId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'

async function missionCall(env, path, method = 'GET', body) {
  const url = new URL(`https://bestcode.test${path}`)
  return handleMissionApi(new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }), env, url)
}

async function executionCall(env, path, method = 'GET', body, headers = {}) {
  const url = new URL(`https://bestcode.test${path}`)
  return handleMissionExecutionApi(new Request(url, {
    method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env, url)
}

async function executionPlan() {
  const now = '2026-07-24T00:00:00.000Z'
  const task = {
    schema_version: 'bestcode-execution-task-v1',
    task_id: taskId,
    project_id: projectId,
    mission_id: missionId,
    plan_id: planId,
    title: 'Round-trip task',
    objective: 'Verify the durable REST facade',
    scope: ['backend/**'],
    input_references: ['mission-context'],
    expected_output: 'verified runtime',
    done_criteria: ['round-trip passes'],
    dependencies: [],
    status: 'planned',
    safety_class: 'read-only',
    preferred_agent_capabilities: ['test'],
    assigned_agent_id: null,
    lease_id: null,
    attempt_count: 0,
    max_attempts: 2,
    timeout_seconds: 300,
    idempotency_key: 'rest-task-key-0001',
    progress: 0,
    result: null,
    evidence_ids: [],
    blocker: null,
    approval_requirement: null,
    created_at: now,
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
    objective: 'REST execution round-trip',
    generated_from_context_version: 1,
    generated_from_context_hash: 'sha256:mission-context',
    planning_actor: 'planner-api',
    created_at: now,
    status: 'draft',
    task_ids: [taskId],
    dependency_graph: { [taskId]: [] },
    safety_constraints: ['no production mutation'],
    approval_gates: [],
    plan_version: 1,
    supersedes_plan_id: null,
    evidence_references: ['ev-plan'],
    deterministic_hash: '',
  }
  plan.deterministic_hash = await deterministicExecutionHash(plan)
  return { plan, tasks: [task] }
}

test('Mission execution REST facade persists commands and exposes status and context', async () => {
  const env = testEnv()
  const createdMission = await missionCall(env, '/api/missions', 'POST', {
    mission_id: missionId,
    project_id: projectId,
    title: 'Execution API Mission',
  })
  assert.equal(createdMission.status, 201)

  const created = await executionCall(env, `/api/mission-executions/${missionId}/command`, 'POST', {
    command: 'mission_execution_plan_create',
    project_id: projectId,
    expected_version: 0,
    ...(await executionPlan()),
  }, {
    'Idempotency-Key': 'rest-create-key-0001',
    'X-BestCode-Agent-Id': 'planner-api',
  })
  assert.equal(created.status, 200)
  assert.equal((await created.json()).state.version, 1)

  const activated = await executionCall(env, `/api/mission-executions/${missionId}/command`, 'POST', {
    command: 'mission_execution_plan_activate',
    project_id: projectId,
    expected_version: 1,
    plan_id: planId,
  }, {
    'Idempotency-Key': 'rest-activate-key-1',
    'X-BestCode-Agent-Id': 'planner-api',
  })
  assert.equal(activated.status, 200)

  const status = await (await executionCall(env, `/api/mission-executions/${missionId}/status`)).json()
  assert.equal(status.active_plan_id, planId)
  assert.equal(status.task_counts.ready, 1)

  const context = await (await executionCall(
    env,
    `/api/mission-executions/${missionId}/context?task_id=${taskId}`,
  )).json()
  const repeatedContext = await (await executionCall(
    env,
    `/api/mission-executions/${missionId}/context?task_id=${taskId}`,
  )).json()
  assert.equal(context.task_id, taskId)
  assert.equal(context.deterministic_hash, repeatedContext.deterministic_hash)
  assert.match(context.deterministic_hash, /^sha256:/)
  assert.ok(context.allowed_tools.includes('mission_task_result_submit'))
  assert.ok(context.denied_tools.includes('deploy'))
})

test('Mission execution REST facade rejects cross-project commands', async () => {
  const env = testEnv()
  await missionCall(env, '/api/missions', 'POST', {
    mission_id: missionId,
    project_id: projectId,
    title: 'Scoped Mission',
  })

  const response = await executionCall(env, `/api/mission-executions/${missionId}/command`, 'POST', {
    command: 'mission_execution_plan_create',
    project_id: 'other-project',
    expected_version: 0,
    ...(await executionPlan()),
  }, { 'Idempotency-Key': 'rest-scope-key-00001' })
  assert.equal(response.status, 409)
})

test('owner/full tool executor reaches the same durable aggregate', async () => {
  const env = testEnv()
  await missionCall(env, '/api/missions', 'POST', {
    mission_id: missionId,
    project_id: projectId,
    title: 'Tool Mission',
  })
  const context = {
    profile: 'legacy',
    request_id: 'tool-round-trip-request',
    actor: { id: 'planner-tool', provider: 'provider-neutral' },
    timeout_ms: 30_000,
    transport: 'mcp',
  }
  const created = await executeMissionExecutionTool('mission_execution_plan_create', {
    project_id: projectId,
    mission_id: missionId,
    idempotency_key: 'tool-create-key-0001',
    expected_version: 0,
    ...(await executionPlan()),
  }, env, context)
  assert.equal(created.isError, undefined)
  assert.equal(created.structuredContent.result.version, 1)

  const status = await executeMissionExecutionTool('mission_execution_status', {
    project_id: projectId,
    mission_id: missionId,
  }, env, context)
  assert.equal(status.structuredContent.result.execution.version, 1)
})
