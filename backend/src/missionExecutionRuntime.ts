import {
  assertExecutionTaskTransition,
  deterministicExecutionHash,
  executionTaskReadiness,
  type ExecutionTask,
} from './missionExecutionSchema'

export type AgentCapability =
  | 'repository-read' | 'repository-write' | 'test' | 'review'
  | 'documentation' | 'architecture' | 'deployment-observe'

export interface AgentRegistration {
  agent_id: string
  provider: string
  capabilities: AgentCapability[]
  safety_classes: ExecutionTask['safety_class'][]
  project_ids: string[]
  enabled: boolean
}

export interface TaskLease {
  lease_id: string
  project_id: string
  mission_id: string
  task_id: string
  agent_id: string
  issued_at: string
  expires_at: string
  heartbeat_at: string
  released_at: string | null
  release_reason: string | null
  attempt_id: string
  fencing_token: number
}

export interface TaskAttempt {
  attempt_id: string
  task_id: string
  agent_id: string
  lease_id: string
  started_at: string
  ended_at: string | null
  outcome: 'running' | 'succeeded' | 'failed' | 'cancelled'
  error_code: string | null
  retryable: boolean
  changed_files: string[]
  test_status: 'not_run' | 'running' | 'passed' | 'failed'
  evidence_ids: string[]
  handoff_packet: unknown | null
  usage_metadata: Record<string, number>
  audit_metadata: Record<string, string>
}

export type ProgressKind =
  | 'started' | 'context_loaded' | 'analysis_complete' | 'change_prepared'
  | 'tests_running' | 'tests_passed' | 'tests_failed' | 'blocked'
  | 'waiting_for_approval' | 'completed'

export interface ProgressEvent {
  event_id: string
  project_id: string
  mission_id: string
  task_id: string
  attempt_id: string
  lease_id: string
  agent_id: string
  kind: ProgressKind
  message: string
  created_at: string
  fencing_token: number
}

export interface TaskBlocker {
  blocker_id: string
  code:
    | 'missing_information' | 'permission_required' | 'secret_required' | 'payment_required'
    | 'environment_failure' | 'test_failure' | 'merge_conflict' | 'dependency_failure'
    | 'product_decision' | 'security_risk' | 'irreversible_action' | 'unknown'
  description: string
  owner_action_required: boolean
  retryable: boolean
  evidence_ids: string[]
  created_at: string
  resolved_at: string | null
}

export interface TaskResult {
  summary: string
  completed_work: string[]
  changed_files: string[]
  test_results: string[]
  evidence_references: string[]
  unresolved_issues: string[]
  deviations: string[]
  decisions_required: string[]
  suggested_next_action: string
  result_hash: string
}

export interface RetryPolicy {
  max_attempts: number
  retryable_error_codes: string[]
  backoff_seconds: number[]
  agent_strategy: 'same' | 'alternate'
  context_refresh_required: boolean
}

const OWNER_GATE_CLASSES = new Set([
  'production_mutation', 'merge', 'deploy', 'rollback', 'secret_or_credential_change',
  'repository_visibility', 'permission_change', 'paid_resource',
  'irreversible_data_migration', 'destructive_delete',
])

export function assertAgentAssignment(
  task: ExecutionTask,
  agent: AgentRegistration,
  requiredCapabilities: AgentCapability[],
): void {
  if (!agent.enabled || !agent.project_ids.includes(task.project_id)) throw new Error('Agent is not enabled for this project')
  if (!agent.safety_classes.includes(task.safety_class)) throw new Error('Agent safety profile does not allow this task')
  for (const capability of requiredCapabilities) {
    if (!agent.capabilities.includes(capability)) throw new Error(`Agent lacks capability ${capability}`)
  }
  if (task.safety_class !== 'read-only' && !agent.capabilities.includes('repository-write')) {
    throw new Error('Read-only agent cannot receive a write task')
  }
}

export function acquireTaskLease(input: {
  task: ExecutionTask
  current: TaskLease | null
  agentId: string
  leaseId: string
  attemptId: string
  now: Date
  ttlSeconds: number
}): TaskLease {
  if (input.task.status !== 'ready') throw new Error('Only a ready task may be leased')
  if (input.current && !input.current.released_at && Date.parse(input.current.expires_at) > input.now.getTime()) {
    throw new Error('Task already has an active lease')
  }
  const fencingToken = (input.current?.fencing_token ?? 0) + 1
  return {
    lease_id: input.leaseId,
    project_id: input.task.project_id,
    mission_id: input.task.mission_id,
    task_id: input.task.task_id,
    agent_id: input.agentId,
    issued_at: input.now.toISOString(),
    expires_at: new Date(input.now.getTime() + Math.min(Math.max(input.ttlSeconds, 15), 900) * 1000).toISOString(),
    heartbeat_at: input.now.toISOString(),
    released_at: null,
    release_reason: null,
    attempt_id: input.attemptId,
    fencing_token: fencingToken,
  }
}

export function assertActiveLease(
  lease: TaskLease | null,
  actor: { project_id: string; mission_id: string; task_id: string; agent_id: string; lease_id: string; fencing_token: number },
  now = new Date(),
): asserts lease is TaskLease {
  if (!lease || lease.released_at) throw new Error('Task lease is not active')
  if (Date.parse(lease.expires_at) <= now.getTime()) throw new Error('Task lease has expired')
  for (const key of ['project_id', 'mission_id', 'task_id', 'agent_id', 'lease_id'] as const) {
    if (lease[key] !== actor[key]) throw new Error(`Task lease ${key} mismatch`)
  }
  if (lease.fencing_token !== actor.fencing_token) throw new Error('Stale fencing token')
}

export function heartbeatTaskLease(lease: TaskLease, now: Date, ttlSeconds: number, fencingToken: number): TaskLease {
  assertActiveLease(lease, { ...lease, fencing_token: fencingToken }, now)
  return {
    ...lease,
    heartbeat_at: now.toISOString(),
    expires_at: new Date(now.getTime() + Math.min(Math.max(ttlSeconds, 15), 900) * 1000).toISOString(),
  }
}

export function appendProgress(events: ProgressEvent[], event: ProgressEvent, lease: TaskLease, now = new Date()): ProgressEvent[] {
  assertActiveLease(lease, event, now)
  if (events.some((item) => item.event_id === event.event_id)) throw new Error('Duplicate progress event')
  return [...events, event]
}

export function assertOwnerApprovalGate(gateClass: string, approval: { status: string; actor: string } | null): void {
  if (!OWNER_GATE_CLASSES.has(gateClass)) return
  if (!approval || approval.status !== 'approved' || approval.actor !== 'owner') {
    throw new Error(`Owner approval is required for ${gateClass}`)
  }
}

export async function buildTaskResult(input: Omit<TaskResult, 'result_hash'>): Promise<TaskResult> {
  if (!input.summary.trim() || input.evidence_references.length === 0) {
    throw new Error('Task result requires a summary and evidence')
  }
  return { ...input, result_hash: await deterministicExecutionHash(input) }
}

export async function assertTaskResult(result: TaskResult): Promise<void> {
  if (result.result_hash !== await deterministicExecutionHash(result)) throw new Error('Task result hash mismatch')
  if (result.evidence_references.length === 0) throw new Error('Task result requires evidence')
}

export function retryTask(task: ExecutionTask, errorCode: string, policy: RetryPolicy): ExecutionTask {
  if (!policy.retryable_error_codes.includes(errorCode)) throw new Error(`Error ${errorCode} is not retryable`)
  if (task.attempt_count >= Math.min(policy.max_attempts, task.max_attempts)) throw new Error('Maximum attempts reached')
  if (['AUTHENTICATION_DENIED', 'PERMISSION_DENIED', 'APPROVAL_DENIED', 'SAFETY_VIOLATION'].includes(errorCode)) {
    throw new Error(`${errorCode} cannot be blindly retried`)
  }
  return { ...task, status: 'ready', lease_id: null, assigned_agent_id: null, blocker: null, version: task.version + 1 }
}

export function refreshReadyTasks(tasks: ExecutionTask[]): ExecutionTask[] {
  return tasks.map((task) => {
    if (task.status !== 'planned' && task.status !== 'blocked') return task
    const next = executionTaskReadiness(task, tasks)
    return next === task.status ? task : { ...task, status: next, version: task.version + 1 }
  })
}

export function cancelTask(task: ExecutionTask, now = new Date()): ExecutionTask {
  assertExecutionTaskTransition(task.status, 'cancelled')
  return { ...task, status: 'cancelled', cancelled_at: now.toISOString(), version: task.version + 1 }
}

