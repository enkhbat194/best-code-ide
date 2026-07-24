import { assertActiveLease } from './missionExecutionRuntime'
import { getMissionExecution } from './missionExecutionStore'
import type { MissionExecutionState } from './missionExecutionService'
import type { BoundedWritePrincipal } from './boundedWriteCredentialTypes'
import type { IssueBoundedWriteCredentialInput } from './boundedWriteCredentials'
import type { Env } from './types'

export type BoundedWriteMissionBinding = Pick<
  IssueBoundedWriteCredentialInput,
  | 'project_id' | 'mission_id' | 'execution_plan_id' | 'task_id' | 'attempt_id'
  | 'lease_id' | 'fencing_token' | 'agent_id' | 'allowed_paths' | 'approval_record_id'
>

function assertBinding(state: MissionExecutionState, binding: BoundedWriteMissionBinding, now: Date): void {
  if (state.project_id !== binding.project_id) throw new Error('WRITE_AUTHORITY_PROJECT_MISMATCH')
  if (state.mission_id !== binding.mission_id) throw new Error('WRITE_AUTHORITY_MISSION_MISMATCH')
  if (state.cancelled_at) throw new Error('WRITE_AUTHORITY_MISSION_CANCELLED')
  if (state.active_plan_id !== binding.execution_plan_id) throw new Error('WRITE_AUTHORITY_PLAN_INACTIVE')

  const task = state.tasks.find((item) => item.task_id === binding.task_id)
  if (!task) throw new Error('WRITE_AUTHORITY_TASK_NOT_FOUND')
  if (task.project_id !== binding.project_id || task.mission_id !== binding.mission_id) {
    throw new Error('WRITE_AUTHORITY_TASK_SCOPE_MISMATCH')
  }
  if (task.plan_id !== binding.execution_plan_id) throw new Error('WRITE_AUTHORITY_TASK_PLAN_MISMATCH')
  if (task.status !== 'running') throw new Error('WRITE_AUTHORITY_TASK_NOT_RUNNING')
  if (task.safety_class !== 'approval-required') throw new Error('WRITE_AUTHORITY_SAFETY_CLASS_DENIED')
  if (!task.approval_requirement || task.approval_requirement !== binding.approval_record_id) {
    throw new Error('WRITE_AUTHORITY_APPROVAL_RECORD_MISMATCH')
  }
  const gate = state.approval_gates[task.task_id]
  if (!gate || gate.status !== 'approved' || gate.actor !== 'owner') {
    throw new Error('WRITE_AUTHORITY_OWNER_APPROVAL_REQUIRED')
  }
  if (task.assigned_agent_id !== binding.agent_id || task.lease_id !== binding.lease_id) {
    throw new Error('WRITE_AUTHORITY_AGENT_OR_LEASE_MISMATCH')
  }
  if (!binding.allowed_paths.every((path) => task.scope.includes(path))) {
    throw new Error('WRITE_AUTHORITY_PATH_SCOPE_WIDENING')
  }

  const lease = state.leases.find((item) => item.lease_id === binding.lease_id) ?? null
  assertActiveLease(lease, {
    project_id: binding.project_id,
    mission_id: binding.mission_id,
    task_id: binding.task_id,
    agent_id: binding.agent_id,
    lease_id: binding.lease_id,
    fencing_token: binding.fencing_token,
  }, now)
  if (lease.attempt_id !== binding.attempt_id) throw new Error('WRITE_AUTHORITY_ATTEMPT_MISMATCH')

  const attempt = state.attempts.find((item) => item.attempt_id === binding.attempt_id)
  if (
    !attempt ||
    attempt.task_id !== binding.task_id ||
    attempt.agent_id !== binding.agent_id ||
    attempt.lease_id !== binding.lease_id ||
    attempt.outcome !== 'running' ||
    attempt.ended_at
  ) throw new Error('WRITE_AUTHORITY_ATTEMPT_INACTIVE')
}

export async function assertBoundedWriteMissionAuthority(
  env: Env,
  binding: BoundedWriteMissionBinding,
  now = new Date(),
): Promise<MissionExecutionState> {
  const state = await getMissionExecution(env, binding.mission_id)
  assertBinding(state, binding, now)
  return state
}

export function missionBindingFromPrincipal(principal: BoundedWritePrincipal): BoundedWriteMissionBinding {
  return {
    project_id: principal.project_id,
    mission_id: principal.mission_id,
    execution_plan_id: principal.execution_plan_id,
    task_id: principal.task_id,
    attempt_id: principal.attempt_id,
    lease_id: principal.lease_id,
    fencing_token: principal.fencing_token,
    agent_id: principal.agent_id,
    allowed_paths: principal.allowed_paths,
    approval_record_id: principal.approval_record_id,
  }
}
