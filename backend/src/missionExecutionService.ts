import {
  assertExecutionPlan,
  assertExecutionTaskTransition,
  deterministicExecutionHash,
  type ExecutionPlan,
  type ExecutionTask,
} from './missionExecutionSchema'
import {
  acquireTaskLease,
  appendProgress,
  assertActiveLease,
  assertTaskResult,
  buildTaskResult,
  cancelTask,
  heartbeatTaskLease,
  refreshReadyTasks,
  retryTask,
  type ProgressEvent,
  type RetryPolicy,
  type TaskAttempt,
  type TaskBlocker,
  type TaskLease,
  type TaskResult,
} from './missionExecutionRuntime'

export interface ExecutionAuditEvent {
  event_id: string
  event: string
  actor_id: string
  created_at: string
  task_id: string | null
  attempt_id: string | null
  outcome: 'completed' | 'denied'
}

export interface MissionExecutionState {
  schema_version: 'bestcode-mission-execution-state-v1'
  project_id: string
  mission_id: string
  version: number
  active_plan_id: string | null
  plans: ExecutionPlan[]
  tasks: ExecutionTask[]
  leases: TaskLease[]
  attempts: TaskAttempt[]
  events: ProgressEvent[]
  audit_events: ExecutionAuditEvent[]
  approval_gates: Record<string, { status: 'pending' | 'approved' | 'rejected'; actor: 'owner' | null; decided_at: string | null }>
  processed_idempotency_keys: string[]
  cancelled_at: string | null
  updated_at: string
}

export interface ExecutionCommand {
  command: string
  project_id: string
  mission_id: string
  actor_id: string
  idempotency_key: string
  expected_version?: number
  now: string
  args: Record<string, any>
}

function newState(input: ExecutionCommand): MissionExecutionState {
  return {
    schema_version: 'bestcode-mission-execution-state-v1',
    project_id: input.project_id,
    mission_id: input.mission_id,
    version: 0,
    active_plan_id: null,
    plans: [],
    tasks: [],
    leases: [],
    attempts: [],
    events: [],
    audit_events: [],
    approval_gates: {},
    processed_idempotency_keys: [],
    cancelled_at: null,
    updated_at: input.now,
  }
}

function requireIdempotency(input: ExecutionCommand): void {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotency_key)) {
    throw new Error('A valid idempotency_key is required')
  }
}

function activeLease(state: MissionExecutionState, taskId: string): TaskLease | null {
  return [...state.leases].reverse().find((item) => item.task_id === taskId && !item.released_at) ?? null
}

function taskById(state: MissionExecutionState, taskId: string): ExecutionTask {
  const task = state.tasks.find((item) => item.task_id === taskId)
  if (!task) throw new Error('Execution task not found')
  return task
}

function replaceTask(state: MissionExecutionState, task: ExecutionTask): void {
  state.tasks = state.tasks.map((item) => item.task_id === task.task_id ? task : item)
}

function releaseLease(state: MissionExecutionState, lease: TaskLease, now: string, reason: string): void {
  state.leases = state.leases.map((item) => item.lease_id === lease.lease_id
    ? { ...item, released_at: now, release_reason: reason }
    : item)
}

function leaseActor(input: ExecutionCommand, taskId: string): {
  project_id: string; mission_id: string; task_id: string; agent_id: string; lease_id: string; fencing_token: number
} {
  if (input.args.agent_id && input.args.agent_id !== input.actor_id) throw new Error('Agent identity spoof denied')
  if (input.args.provider || input.args.provider_id || input.args.agent_provider) {
    throw new Error('Provider identity spoof denied')
  }
  return {
    project_id: input.project_id,
    mission_id: input.mission_id,
    task_id: taskId,
    agent_id: input.actor_id,
    lease_id: String(input.args.lease_id ?? ''),
    fencing_token: Number(input.args.fencing_token),
  }
}

function audit(state: MissionExecutionState, input: ExecutionCommand, taskId: string | null, attemptId: string | null): void {
  state.audit_events.push({
    event_id: crypto.randomUUID(),
    event: input.command,
    actor_id: input.actor_id,
    created_at: input.now,
    task_id: taskId,
    attempt_id: attemptId,
    outcome: 'completed',
  })
}

async function handoffPacket(
  task: ExecutionTask,
  attemptId: string,
  blocker: TaskBlocker,
): Promise<Record<string, unknown>> {
  const packet = {
    schema_version: 'bestcode-execution-handoff-packet-v1',
    execution_plan_id: task.plan_id,
    task_id: task.task_id,
    attempt_id: attemptId,
    lease_state: 'released',
    dependency_state: task.dependencies,
    current_blocker: blocker,
    retry_count: task.attempt_count,
    next_exact_action: blocker.owner_action_required
      ? 'Wait for the required owner action.'
      : 'Apply the retry policy with refreshed context.',
    required_capability: task.preferred_agent_capabilities,
  }
  return { ...packet, deterministic_hash: await deterministicExecutionHash(packet) }
}

export async function applyExecutionCommand(
  current: MissionExecutionState | null,
  input: ExecutionCommand,
): Promise<{ state: MissionExecutionState; replayed: boolean }> {
  requireIdempotency(input)
  const state = structuredClone(current ?? newState(input))
  if (state.project_id !== input.project_id || state.mission_id !== input.mission_id) {
    throw new Error('Cross-project or cross-Mission execution access denied')
  }
  if (input.expected_version !== undefined && input.expected_version !== state.version) {
    throw new Error(`Execution version mismatch: expected ${input.expected_version}, current ${state.version}`)
  }
  if (state.processed_idempotency_keys.includes(input.idempotency_key)) return { state, replayed: true }
  if (state.cancelled_at && input.command !== 'mission_execution_status') throw new Error('Mission execution is cancelled')
  const now = new Date(input.now)
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid command timestamp')
  let taskId: string | null = typeof input.args.task_id === 'string' ? input.args.task_id : null
  let attemptId: string | null = typeof input.args.attempt_id === 'string' ? input.args.attempt_id : null

  switch (input.command) {
    case 'mission_execution_plan_create': {
      const plan = structuredClone(input.args.plan) as ExecutionPlan
      const tasks = structuredClone(input.args.tasks) as ExecutionTask[]
      if (!plan || !Array.isArray(tasks)) throw new Error('plan and tasks are required')
      if (plan.project_id !== input.project_id || plan.mission_id !== input.mission_id) throw new Error('Execution plan scope mismatch')
      assertExecutionPlan(plan, tasks)
      const expectedVersion = Math.max(0, ...state.plans.map((item) => item.plan_version)) + 1
      if (plan.plan_version !== expectedVersion) throw new Error(`Execution plan version must be ${expectedVersion}`)
      if (plan.supersedes_plan_id !== (state.plans.at(-1)?.plan_id ?? null)) throw new Error('Execution plan supersession mismatch')
      const expectedHash = await deterministicExecutionHash(plan)
      if (plan.deterministic_hash !== expectedHash) throw new Error('Execution plan hash mismatch')
      if (state.plans.some((item) => item.plan_id === plan.plan_id)) throw new Error('Execution plan already exists')
      if (tasks.some((task) => state.tasks.some((existing) => existing.task_id === task.task_id))) {
        throw new Error('Execution task ID already exists in this Mission')
      }
      state.plans.push(plan)
      state.tasks.push(...tasks)
      break
    }
    case 'mission_execution_plan_activate': {
      const plan = state.plans.find((item) => item.plan_id === input.args.plan_id)
      if (!plan || plan.status !== 'draft') throw new Error('Only a draft plan may be activated')
      const unfinishedPriorTask = state.tasks.find((task) =>
        task.plan_id !== plan.plan_id &&
        ['leased', 'running', 'waiting_for_input', 'waiting_for_approval'].includes(task.status))
      if (unfinishedPriorTask) throw new Error(`Active work must stop before plan supersession: ${unfinishedPriorTask.task_id}`)
      state.plans = state.plans.map((item) => item.plan_id === plan.plan_id
        ? { ...item, status: 'active' }
        : item.status === 'active' ? { ...item, status: 'superseded' } : item)
      state.active_plan_id = plan.plan_id
      state.tasks = state.tasks.map((task) =>
        task.plan_id !== plan.plan_id && ['planned', 'blocked', 'ready'].includes(task.status)
          ? { ...task, status: 'superseded', version: task.version + 1 }
          : task)
      for (const task of state.tasks.filter((item) => item.plan_id === plan.plan_id && item.approval_requirement)) {
        state.approval_gates[task.task_id] = { status: 'pending', actor: null, decided_at: null }
      }
      state.tasks = refreshReadyTasks(state.tasks)
      break
    }
    case 'mission_task_lease_acquire': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      if (task.plan_id !== state.active_plan_id) throw new Error('Task plan is not active')
      attemptId = String(input.args.attempt_id ?? '')
      const lease = acquireTaskLease({
        task,
        current: activeLease(state, taskId),
        agentId: input.actor_id,
        leaseId: String(input.args.lease_id ?? ''),
        attemptId,
        now,
        ttlSeconds: Number(input.args.ttl_seconds ?? 60),
      })
      const attempt: TaskAttempt = {
        attempt_id: attemptId,
        task_id: taskId,
        agent_id: input.actor_id,
        lease_id: lease.lease_id,
        started_at: input.now,
        ended_at: null,
        outcome: 'running',
        error_code: null,
        retryable: false,
        changed_files: [],
        test_status: 'not_run',
        evidence_ids: [],
        handoff_packet: null,
        usage_metadata: {},
        audit_metadata: { project_id: input.project_id, mission_id: input.mission_id },
      }
      if (!attemptId || state.attempts.some((item) => item.attempt_id === attemptId)) throw new Error('A unique attempt_id is required')
      state.leases.push(lease)
      state.attempts.push(attempt)
      replaceTask(state, {
        ...task,
        status: 'leased',
        assigned_agent_id: input.actor_id,
        lease_id: lease.lease_id,
        attempt_count: task.attempt_count + 1,
        version: task.version + 1,
      })
      break
    }
    case 'mission_task_lease_heartbeat': {
      if (!taskId) throw new Error('task_id is required')
      const lease = activeLease(state, taskId)
      assertActiveLease(lease, leaseActor(input, taskId), now)
      const renewed = heartbeatTaskLease(lease, now, Number(input.args.ttl_seconds ?? 60), Number(input.args.fencing_token))
      state.leases = state.leases.map((item) => item.lease_id === renewed.lease_id ? renewed : item)
      break
    }
    case 'mission_task_progress_append': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      const lease = activeLease(state, taskId)
      assertActiveLease(lease, leaseActor(input, taskId), now)
      const event = { ...input.args.event, project_id: input.project_id, mission_id: input.mission_id, task_id: taskId, attempt_id: lease.attempt_id, lease_id: lease.lease_id, agent_id: input.actor_id, fencing_token: lease.fencing_token, created_at: input.now } as ProgressEvent
      state.events = appendProgress(state.events, event, lease, now)
      if (task.status === 'leased' && event.kind === 'started') {
        assertExecutionTaskTransition(task.status, 'running')
        replaceTask(state, { ...task, status: 'running', started_at: task.started_at ?? input.now, version: task.version + 1 })
      } else if (task.status === 'running' && event.kind === 'waiting_for_approval') {
        if (!task.approval_requirement) throw new Error('Task has no approval gate')
        assertExecutionTaskTransition(task.status, 'waiting_for_approval')
        replaceTask(state, { ...task, status: 'waiting_for_approval', version: task.version + 1 })
      }
      break
    }
    case 'mission_task_result_submit': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      const lease = activeLease(state, taskId)
      assertActiveLease(lease, leaseActor(input, taskId), now)
      if (task.status !== 'running') throw new Error('Only a running task may submit a result')
      if (task.approval_requirement && state.approval_gates[taskId]?.status !== 'approved') throw new Error('Owner approval gate is not approved')
      const result = input.args.result?.result_hash
        ? input.args.result as TaskResult
        : await buildTaskResult(input.args.result as Omit<TaskResult, 'result_hash'>)
      await assertTaskResult(result)
      assertExecutionTaskTransition(task.status, 'succeeded')
      replaceTask(state, { ...task, status: 'succeeded', result, evidence_ids: result.evidence_references, progress: 100, completed_at: input.now, lease_id: null, version: task.version + 1 })
      state.attempts = state.attempts.map((item) => item.attempt_id === lease.attempt_id
        ? { ...item, ended_at: input.now, outcome: 'succeeded', changed_files: result.changed_files, test_status: result.test_results.length ? 'passed' : item.test_status, evidence_ids: result.evidence_references }
        : item)
      releaseLease(state, lease, input.now, 'result_submitted')
      state.tasks = refreshReadyTasks(state.tasks)
      break
    }
    case 'mission_task_block': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      const lease = activeLease(state, taskId)
      assertActiveLease(lease, leaseActor(input, taskId), now)
      const blocker = { ...input.args.blocker, created_at: input.now, resolved_at: null } as TaskBlocker
      if (!blocker.blocker_id || !blocker.code || !blocker.description) throw new Error('A valid blocker is required')
      assertExecutionTaskTransition(task.status, 'blocked')
      replaceTask(state, { ...task, status: 'blocked', blocker, lease_id: null, version: task.version + 1 })
      const handoff = await handoffPacket(task, lease.attempt_id, blocker)
      state.attempts = state.attempts.map((item) => item.attempt_id === lease.attempt_id
        ? {
            ...item,
            ended_at: input.now,
            outcome: 'failed',
            error_code: blocker.code,
            retryable: blocker.retryable,
            evidence_ids: blocker.evidence_ids,
            handoff_packet: handoff,
          }
        : item)
      releaseLease(state, lease, input.now, 'blocked')
      break
    }
    case 'mission_task_retry': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      const policy = input.args.retry_policy as RetryPolicy
      replaceTask(state, retryTask(task, String(input.args.error_code ?? ''), policy))
      break
    }
    case 'mission_task_cancel': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      const lease = activeLease(state, taskId)
      if (lease) {
        assertActiveLease(lease, leaseActor(input, taskId), now)
        releaseLease(state, lease, input.now, 'cancelled')
      }
      replaceTask(state, cancelTask(task, now))
      break
    }
    case 'mission_task_lease_release': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      const lease = activeLease(state, taskId)
      assertActiveLease(lease, leaseActor(input, taskId), now)
      releaseLease(state, lease, input.now, String(input.args.release_reason ?? 'released'))
      replaceTask(state, { ...task, status: 'ready', assigned_agent_id: null, lease_id: null, version: task.version + 1 })
      break
    }
    case 'mission_execution_approve_gate':
    case 'mission_execution_reject_gate': {
      if (!taskId) throw new Error('task_id is required')
      const task = taskById(state, taskId)
      if (!task.approval_requirement) throw new Error('Task has no approval gate')
      const currentGate = state.approval_gates[taskId]
      if (!currentGate || currentGate.status !== 'pending') throw new Error('Approval gate is not pending')
      if (task.status !== 'waiting_for_approval') throw new Error('Task is not waiting for approval')
      const approved = input.command.endsWith('approve_gate')
      state.approval_gates[taskId] = {
        status: approved ? 'approved' : 'rejected',
        actor: 'owner',
        decided_at: input.now,
      }
      if (approved) {
        assertExecutionTaskTransition(task.status, 'running')
        replaceTask(state, { ...task, status: 'running', version: task.version + 1 })
      } else {
        const lease = activeLease(state, taskId)
        if (lease) {
          releaseLease(state, lease, input.now, 'approval_rejected')
          state.attempts = state.attempts.map((item) => item.attempt_id === lease.attempt_id
            ? { ...item, ended_at: input.now, outcome: 'failed', error_code: 'APPROVAL_DENIED', retryable: false }
            : item)
        }
        replaceTask(state, { ...task, status: 'failed', failed_at: input.now, version: task.version + 1 })
      }
      break
    }
    case 'mission_execution_cancel': {
      state.cancelled_at = input.now
      state.plans = state.plans.map((plan) => plan.status === 'active' || plan.status === 'draft'
        ? { ...plan, status: 'cancelled' }
        : plan)
      state.tasks = state.tasks.map((task) => ['succeeded', 'failed', 'cancelled', 'superseded'].includes(task.status)
        ? task
        : cancelTask(task, now))
      state.leases = state.leases.map((lease) => lease.released_at ? lease : { ...lease, released_at: input.now, release_reason: 'execution_cancelled' })
      state.attempts = state.attempts.map((attempt) => attempt.outcome === 'running'
        ? { ...attempt, ended_at: input.now, outcome: 'cancelled', error_code: 'EXECUTION_CANCELLED', retryable: false }
        : attempt)
      break
    }
    default:
      throw new Error(`Unsupported Mission execution command: ${input.command}`)
  }

  state.version += 1
  state.updated_at = input.now
  state.processed_idempotency_keys = [...state.processed_idempotency_keys, input.idempotency_key].slice(-500)
  audit(state, input, taskId, attemptId)
  return { state, replayed: false }
}

export async function buildExecutionContextPacket(state: MissionExecutionState, taskId: string): Promise<Record<string, unknown>> {
  const task = taskById(state, taskId)
  const plan = state.plans.find((item) => item.plan_id === task.plan_id)
  if (!plan) throw new Error('Execution plan not found')
  const dependencies = task.dependencies.map((edge) => ({
    ...edge,
    status: taskById(state, edge.task_id).status,
  }))
  const packet = {
    schema_version: 'bestcode-task-context-packet-v1',
    project_id: state.project_id,
    mission_id: state.mission_id,
    plan_id: plan.plan_id,
    task_id: task.task_id,
    objective: task.objective,
    done_criteria: task.done_criteria,
    dependencies,
    context_version: plan.generated_from_context_version,
    context_hash: plan.generated_from_context_hash,
    architecture_decisions: task.input_references.filter((reference) => /^(adr|decision):/i.test(reference)),
    relevant_brain_summary: null,
    relevant_repository_state: {
      base_sha: null,
      active_branch: null,
      active_pull_request: null,
    },
    allowed_tools: [
      'mission_task_lease_heartbeat',
      'mission_task_progress_append',
      'mission_task_result_submit',
      'mission_task_block',
      'mission_task_lease_release',
    ],
    denied_tools: [
      'mission_execution_approve_gate',
      'mission_execution_reject_gate',
      'merge',
      'deploy',
      'rollback',
    ],
    safety_constraints: plan.safety_constraints,
    approval_gates: plan.approval_gates,
    previous_attempts: state.attempts.filter((item) => item.task_id === taskId),
    unresolved_blocker: task.blocker,
    next_exact_action: task.status === 'ready' ? 'Acquire a task lease.' : task.status,
  }
  return { ...packet, deterministic_hash: await deterministicExecutionHash(packet) }
}

export function executionStatus(state: MissionExecutionState): Record<string, unknown> {
  const counts = Object.fromEntries([...new Set(state.tasks.map((item) => item.status))]
    .map((status) => [status, state.tasks.filter((item) => item.status === status).length]))
  const current = state.tasks.find((item) => ['leased', 'running', 'waiting_for_input', 'waiting_for_approval'].includes(item.status))
  const blocked = state.tasks.find((item) => item.status === 'blocked')
  return {
    project_id: state.project_id,
    mission_id: state.mission_id,
    version: state.version,
    active_plan_id: state.active_plan_id,
    cancelled_at: state.cancelled_at,
    task_counts: counts,
    current_agent: current?.assigned_agent_id ?? null,
    current_task: current?.task_id ?? null,
    latest_progress: state.events.at(-1) ?? null,
    blocker: blocked?.blocker ?? null,
    next_action: blocked ? 'Resolve the current blocker.' : current ? current.status : 'Activate or close out the execution plan.',
  }
}
