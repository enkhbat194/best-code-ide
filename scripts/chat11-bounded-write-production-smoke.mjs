#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MCP_PROTOCOL_VERSION = '2025-11-25'
export const SMOKE_AGENT_ID = 'github-actions-openai-bounded-smoke'
export const SMOKE_PROVIDER = 'openai'
export const SMOKE_APPROVAL = 'chat11_bounded_write_smoke'
export const SMOKE_ALLOWED_TOOLS = Object.freeze([
  'project_get',
  'mission_get',
  'mission_context_get',
  'repository_create_branch',
  'repository_write_file',
  'repository_apply_patch',
  'repository_commit',
  'repository_push',
  'build_start',
  'build_status',
  'test_start',
  'test_status',
  'repository_create_pull_request',
  'pull_request_status',
  'mission_task_get',
  'mission_execution_status',
  'mission_attempt_get',
  'mission_event_list',
  'mission_task_progress_append',
  'mission_task_result_submit',
  'mission_task_lease_release',
])

const SECRET_PATTERN = /(?:bcwrite_v1\.[A-Za-z0-9._-]+|Bearer\s+[A-Za-z0-9._~+/-]{8,}=?)/gi

function bounded(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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

function deterministicId(runKey, label) {
  const hex = sha256(`${runKey}:${label}`).slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = '8'
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function idempotency(runKey, label) {
  return `chat11-${label}-${sha256(runKey).slice(0, 24)}`.slice(0, 128)
}

function fullSha(value) {
  const result = bounded(value, 64).toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error('Expected SHA must be a full 40-character commit SHA')
  return result
}

function safeRunKey(value) {
  const result = bounded(value, 60).replace(/[^A-Za-z0-9_-]/g, '-')
  if (!result) throw new Error('Smoke run key is required')
  return result
}

export function buildSmokeFixture(runKeyInput, baseShaInput, createdAt = '2026-07-25T00:00:00.000Z') {
  const runKey = safeRunKey(runKeyInput)
  const baseSha = fullSha(baseShaInput)
  const suffix = sha256(runKey).slice(0, 16)
  const missionId = deterministicId(runKey, 'mission')
  const planId = deterministicId(runKey, 'plan')
  const taskId = deterministicId(runKey, 'task')
  const attemptId = deterministicId(runKey, 'attempt')
  const leaseId = deterministicId(runKey, 'lease')
  const branch = `agent/chat11-smoke-${suffix}`
  const path = `docs/smoke/chat11-${suffix}.md`
  const task = {
    schema_version: 'bestcode-execution-task-v1',
    task_id: taskId,
    project_id: 'bestcode',
    mission_id: missionId,
    plan_id: planId,
    title: 'Chat 11 bounded-write connector smoke',
    objective: 'Create and amend one isolated smoke file, verify CI, and open one draft PR.',
    scope: ['docs/smoke/**'],
    input_references: [`main:${baseSha}`, `smoke-run:${runKey}`],
    expected_output: 'One draft PR containing one docs/smoke file and immutable evidence.',
    done_criteria: ['One changed file, one commit, one push, one draft PR, successful build and tests.'],
    dependencies: [],
    status: 'planned',
    safety_class: 'approval-required',
    preferred_agent_capabilities: ['repository-write', 'test'],
    assigned_agent_id: null,
    lease_id: null,
    attempt_count: 0,
    max_attempts: 1,
    timeout_seconds: 1800,
    idempotency_key: idempotency(runKey, 'task-contract'),
    progress: 0,
    result: null,
    evidence_ids: [],
    blocker: null,
    approval_requirement: SMOKE_APPROVAL,
    created_at: createdAt,
    started_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    version: 1,
  }
  const plan = {
    schema_version: 'bestcode-execution-plan-v1',
    plan_id: planId,
    project_id: 'bestcode',
    mission_id: missionId,
    objective: `Chat 11 isolated bounded-write production smoke ${runKey}`,
    generated_from_context_version: 1,
    generated_from_context_hash: `sha256:${sha256(`context:${runKey}`)}`,
    planning_actor: 'github-actions-owner-smoke',
    created_at: createdAt,
    status: 'draft',
    task_ids: [taskId],
    dependency_graph: { [taskId]: [] },
    safety_constraints: [
      'docs/smoke/** only',
      'one changed file, commit, push, and draft pull request',
      'merge, deploy, rollback, secrets, and protected paths unavailable',
      `source locked to main:${baseSha}`,
    ],
    approval_gates: [SMOKE_APPROVAL],
    plan_version: 1,
    supersedes_plan_id: null,
    evidence_references: [`ev-chat11-plan-${suffix}`],
    deterministic_hash: '',
  }
  plan.deterministic_hash = deterministicHash(plan)
  return { runKey, suffix, baseSha, missionId, planId, taskId, attemptId, leaseId, branch, path, task, plan }
}

function sanitize(value, secrets = []) {
  let result = bounded(value instanceof Error ? value.message : String(value), 1000)
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[REDACTED]')
  return result
    .replace(SECRET_PATTERN, '[REDACTED]')
    .replace(/bearer\s+\S+/gi, '[REDACTED_CREDENTIAL]')
    .replace(/authorization/gi, '[REDACTED_HEADER]')
}

export function assertEvidenceSafe(evidence, secrets = []) {
  const serialized = JSON.stringify(evidence)
  for (const secret of secrets.filter(Boolean)) {
    if (serialized.includes(secret)) throw new Error('Evidence contains a secret value')
  }
  SECRET_PATTERN.lastIndex = 0
  if (SECRET_PATTERN.test(serialized)) throw new Error('Evidence contains a credential marker')
  if (/authorization/i.test(serialized)) throw new Error('Evidence contains a sensitive header name')
  return true
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function codeFrom(body) {
  return bounded(
    body?.error?.data?.code ??
    body?.error?.code ??
    body?.result?.structuredContent?.error?.code ??
    body?.structuredContent?.error?.code ??
    'DENIED',
    120,
  )
}

function structured(body) {
  return body?.result?.structuredContent ?? null
}

export async function runBoundedWriteProductionSmoke(options) {
  const startedAt = new Date().toISOString()
  const fixture = buildSmokeFixture(options.runKey, options.expectedSha, startedAt)
  const baseUrl = bounded(options.backendUrl, 300).replace(/\/$/, '')
  const ownerToken = bounded(options.ownerToken, 4096)
  const githubToken = bounded(options.githubToken, 4096)
  const repository = bounded(options.repository || 'enkhbat194/best-code-ide', 200)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const secrets = [ownerToken, githubToken]
  let credentialSecret = ''
  let credentialId = ''
  let missionCreated = false
  let executionCreated = false
  let executionState = null
  let operationId = ''
  let prNumber = 0
  let commitSha = ''
  let branchCreated = false
  let leaseFencingToken = 0
  let lastLeaseHeartbeat = 0
  let stage = 'initialize'
  let failure = null
  let rpcSequence = 1
  const checks = {}
  const denials = {}
  const cleanup = {
    attempted: false,
    credential_revoked: false,
    execution_cancelled: false,
    mission_cancelled: false,
    pull_request_closed: false,
    branch_deleted: false,
    errors: [],
  }

  const ownerRequest = async (label, path, init = {}, expected = 200) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${ownerToken}`,
      },
    })
    const body = await parseJson(response)
    if (response.status !== expected) {
      throw new Error(`${label} HTTP ${response.status}: ${sanitize(body?.error ?? 'unexpected response', secrets)}`)
    }
    return body
  }

  const githubRequest = async (label, path, init = {}, expected = [200, 204]) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    })
    if (!expected.includes(response.status)) {
      const body = await parseJson(response)
      throw new Error(`${label} HTTP ${response.status}: ${sanitize(body?.message ?? 'unexpected response', secrets)}`)
    }
    return response.status === 204 ? null : parseJson(response)
  }

  const command = async (name, actor, label, args = {}) => {
    const body = await ownerRequest(name, `/api/mission-executions/${fixture.missionId}/command`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotency(fixture.runKey, label),
        'X-BestCode-Agent-Id': actor,
      },
      body: JSON.stringify({
        command: name,
        project_id: 'bestcode',
        expected_version: executionState?.version ?? 0,
        ...args,
      }),
    })
    executionState = body.state
    return body
  }

  const rpc = async (name, args = {}, options = {}) => {
    const requestId = `chat11-smoke-${name}-${fixture.suffix}-${rpcSequence}`
    const idempotencyKey = options.idempotency ? idempotency(fixture.runKey, options.idempotency) : ''
    const toolArguments = idempotencyKey && name.startsWith('mission_')
      ? { ...args, idempotency_key: idempotencyKey }
      : args
    const response = await fetchImpl(`${baseUrl}/mcp/subscription?project_id=bestcode`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        Authorization: `Bearer ${credentialSecret}`,
        'X-BestCode-Agent-Id': SMOKE_AGENT_ID,
        'X-BestCode-Agent-Provider': SMOKE_PROVIDER,
        'X-BestCode-Request-Id': requestId,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcSequence++,
        method: options.method ?? 'tools/call',
        ...((options.method ?? 'tools/call') === 'tools/call'
          ? { params: { name, arguments: toolArguments } }
          : { params: args }),
      }),
    })
    const body = await parseJson(response)
    if (!body) throw new Error(`${name} returned invalid JSON`)
    return { status: response.status, body, envelope: structured(body), code: codeFrom(body) }
  }

  const expectDenied = async (key, name, args, options, acceptedCodes = []) => {
    const result = await rpc(name, args, options)
    const denied = result.status >= 400 || result.body?.error || result.envelope?.ok === false
    assert(denied, `${key} did not fail closed`)
    if (acceptedCodes.length) {
      assert(acceptedCodes.some((code) => result.code.includes(code)), `${key} denial code mismatch: ${result.code}`)
    }
    denials[key] = { denied: true, status: result.status, reason_code: result.code }
    return result
  }

  const call = async (name, args, idempotencyLabel) => {
    const result = await rpc(name, args, idempotencyLabel ? { idempotency: idempotencyLabel } : {})
    if (result.status !== 200 || result.body?.error || result.envelope?.ok !== true) {
      throw new Error(`${name} failed closed: ${result.code}`)
    }
    return result.envelope
  }

  const waitTask = async (kind, taskId) => {
    const statusTool = kind === 'build' ? 'build_status' : 'test_status'
    const deadline = Date.now() + 15 * 60_000
    while (Date.now() < deadline) {
      if (leaseFencingToken && Date.now() - lastLeaseHeartbeat >= 5 * 60_000) {
        lastLeaseHeartbeat = Date.now()
        await command('mission_task_lease_heartbeat', SMOKE_AGENT_ID, `heartbeat-${lastLeaseHeartbeat}`, {
          task_id: fixture.taskId,
          lease_id: fixture.leaseId,
          fencing_token: leaseFencingToken,
          ttl_seconds: 900,
        })
      }
      const result = await call(statusTool, { project_id: 'bestcode', task_id: taskId })
      if (result.status === 'completed') {
        assert(result.result?.conclusion === 'success', `${kind} concluded ${result.result?.conclusion ?? 'unknown'}`)
        return result
      }
      if (result.status === 'failed' || result.status === 'cancelled') {
        throw new Error(`${kind} task ended ${result.status}`)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 15_000))
    }
    throw new Error(`${kind} task timed out`)
  }

  try {
    assert(ownerToken, 'BESTCODE_AUTH_TOKEN is missing')
    assert(githubToken, 'GITHUB_TOKEN is missing')
    assert(/^https:\/\//.test(baseUrl), 'Production backend URL must use HTTPS')

    stage = 'mission_create'
    const mission = await ownerRequest('mission create', '/api/missions', {
      method: 'POST',
      body: JSON.stringify({
        mission_id: fixture.missionId,
        project_id: 'bestcode',
        title: `Chat 11 bounded-write smoke ${fixture.runKey}`,
      }),
    }, 201)
    missionCreated = true
    assert(mission.project_id === 'bestcode' && mission.lifecycle === 'captured', 'Mission scope/lifecycle mismatch')

    stage = 'plan_create'
    await command('mission_execution_plan_create', 'github-actions-owner-smoke', 'plan-create', {
      plan: fixture.plan,
      tasks: [fixture.task],
    })
    executionCreated = true
    await command('mission_execution_plan_activate', 'github-actions-owner-smoke', 'plan-activate', {
      plan_id: fixture.planId,
    })
    await command('mission_task_lease_acquire', SMOKE_AGENT_ID, 'lease-acquire', {
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      attempt_id: fixture.attemptId,
      ttl_seconds: 900,
    })
    const lease = executionState.leases.find((item) => item.lease_id === fixture.leaseId)
    assert(lease?.fencing_token === 1, 'Lease fencing token mismatch')
    leaseFencingToken = lease.fencing_token
    lastLeaseHeartbeat = Date.now()
    await command('mission_task_progress_append', SMOKE_AGENT_ID, 'progress-started', {
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token,
      event: {
        event_id: deterministicId(fixture.runKey, 'event-started'),
        kind: 'started',
        message: 'Started the isolated bounded-write connector smoke.',
      },
    })
    await command('mission_task_progress_append', SMOKE_AGENT_ID, 'progress-waiting', {
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token,
      event: {
        event_id: deterministicId(fixture.runKey, 'event-waiting'),
        kind: 'waiting_for_approval',
        message: 'Waiting for the explicit owner write-task gate.',
      },
    })
    await command('mission_execution_approve_gate', 'owner', 'owner-approve-gate', {
      task_id: fixture.taskId,
      approval_operation_id: SMOKE_APPROVAL,
    })
    checks.mission_authority_active = true
    checks.owner_write_task_gate_approved = true

    stage = 'credential_issue'
    const issued = await ownerRequest('bounded credential issue', '/api/bounded-write/credentials', {
      method: 'POST',
      body: JSON.stringify({
        project_id: 'bestcode',
        mission_id: fixture.missionId,
        execution_plan_id: fixture.planId,
        task_id: fixture.taskId,
        attempt_id: fixture.attemptId,
        lease_id: fixture.leaseId,
        fencing_token: lease.fencing_token,
        agent_id: SMOKE_AGENT_ID,
        provider: SMOKE_PROVIDER,
        branch: fixture.branch,
        base_sha: fixture.baseSha,
        allowed_tools: SMOKE_ALLOWED_TOOLS,
        allowed_paths: ['docs/smoke/**'],
        expires_in_seconds: 1800,
        limits: {
          max_operations: 30,
          max_changed_files: 1,
          max_total_changed_bytes: 4096,
          max_commits: 1,
          max_pushes: 1,
          max_pull_requests: 1,
        },
        idempotency_namespace: `chat11-smoke-${fixture.suffix}`,
        approval_record_id: SMOKE_APPROVAL,
      }),
    }, 201)
    credentialSecret = bounded(issued.secret, 4096)
    credentialId = bounded(issued.credential?.credential_id, 64)
    secrets.push(credentialSecret)
    assert(/^bcwrite_v1\./.test(credentialSecret) && credentialId, 'One-time bounded credential was not returned')
    checks.credential_bound_and_issued = true

    stage = 'connector_initialize'
    const initialized = await rpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'bestcode-chat11-openai-smoke', version: '1.0.0' },
    }, { method: 'initialize' })
    assert(initialized.status === 200, 'MCP initialize failed')
    assert(initialized.body?.result?.serverInfo?.name === 'bestcode-bounded-write-agent-gateway', 'Wrong MCP server profile')
    const listed = await rpc('tools/list', {}, { method: 'tools/list' })
    const advertised = (listed.body?.result?.tools ?? []).map((tool) => tool.name).sort()
    assert(JSON.stringify(advertised) === JSON.stringify([...SMOKE_ALLOWED_TOOLS].sort()), 'Advertised tool scope mismatch')
    checks.actual_mcp_connector_initialized = true

    stage = 'context_reads'
    await call('project_get', { project_id: 'bestcode' })
    await call('mission_get', { project_id: 'bestcode', mission_id: fixture.missionId })
    await call('mission_context_get', { project_id: 'bestcode', mission_id: fixture.missionId })
    await call('mission_task_get', { project_id: 'bestcode', mission_id: fixture.missionId, task_id: fixture.taskId })
    checks.project_and_mission_context_read = true

    stage = 'scope_denials'
    await expectDenied('wrong_project', 'project_get', { project_id: 'czech-app' }, {}, ['PROJECT_SCOPE'])
    await expectDenied('main_branch', 'repository_create_branch', {
      project_id: 'bestcode', name: 'main',
    }, { idempotency: 'deny-main' }, ['BRANCH_SCOPE'])
    await expectDenied('wrong_branch', 'repository_create_branch', {
      project_id: 'bestcode', name: `${fixture.branch}-wrong`,
    }, { idempotency: 'deny-wrong-branch' }, ['BRANCH_SCOPE'])
    await expectDenied('outside_path', 'repository_write_file', {
      project_id: 'bestcode',
      branch: fixture.branch,
      path: 'README.md',
      content: 'denied',
      expected_branch_head_sha: fixture.baseSha,
      expected_old_hash: 'absent',
    }, { idempotency: 'deny-outside-path' }, ['PATH_SCOPE'])
    await expectDenied('protected_path', 'repository_write_file', {
      project_id: 'bestcode',
      branch: fixture.branch,
      path: '.github/workflows/denied.yml',
      content: 'denied',
      expected_branch_head_sha: fixture.baseSha,
      expected_old_hash: 'absent',
    }, { idempotency: 'deny-protected-path' }, ['PROTECTED_PATH'])
    await expectDenied('wrong_mission', 'mission_task_progress_append', {
      project_id: 'bestcode',
      mission_id: deterministicId(fixture.runKey, 'wrong-mission'),
      expected_version: executionState.version,
      event: {
        event_id: deterministicId(fixture.runKey, 'wrong-mission-event'),
        kind: 'context_loaded',
        message: 'This must be denied.',
      },
    }, { idempotency: 'deny-wrong-mission' }, ['MISSION_MISSION_ID_SCOPE'])
    await expectDenied('stale_fencing_token', 'mission_task_progress_append', {
      project_id: 'bestcode',
      mission_id: fixture.missionId,
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token + 1,
      expected_version: executionState.version,
      event: {
        event_id: deterministicId(fixture.runKey, 'stale-fencing-event'),
        kind: 'context_loaded',
        message: 'This stale fencing update must be denied.',
      },
    }, { idempotency: 'deny-stale-fencing' }, ['MISSION_FENCING_TOKEN_SCOPE'])
    for (const [key, tool] of [['deploy_unavailable', 'deployment_start'], ['rollback_unavailable', 'rollback_request']]) {
      await expectDenied(key, tool, { project_id: 'bestcode' }, { idempotency: `deny-${key}` }, ['TOOL_SCOPE'])
    }
    await expectDenied('merge_unavailable', 'repository_merge', { project_id: 'bestcode' }, {}, [])
    checks.fail_closed_scope_denials = true

    stage = 'branch_create'
    const branch = await call('repository_create_branch', {
      project_id: 'bestcode',
      name: fixture.branch,
    }, 'branch-create')
    assert(branch.branch === fixture.branch, 'Smoke branch mismatch')
    branchCreated = true

    stage = 'file_stage'
    const initialContent = [
      '# Chat 11 bounded-write production smoke',
      '',
      `run: ${fixture.suffix}`,
      'status: staged',
      '',
    ].join('\n')
    const staged = await call('repository_write_file', {
      project_id: 'bestcode',
      branch: fixture.branch,
      path: fixture.path,
      content: initialContent,
      expected_branch_head_sha: fixture.baseSha,
      expected_old_hash: 'absent',
      title: 'Chat 11 bounded-write production smoke',
      summary: 'Create one isolated synthetic smoke evidence file.',
    }, 'file-stage')
    operationId = staged.operation_id
    assert(operationId, 'Staged operation ID is missing')

    stage = 'file_patch'
    const patched = await call('repository_apply_patch', {
      project_id: 'bestcode',
      branch: fixture.branch,
      path: fixture.path,
      operation_id: operationId,
      expected_branch_head_sha: fixture.baseSha,
      expected_old_hash: 'absent',
      patch: [
        `--- a/${fixture.path}`,
        `+++ b/${fixture.path}`,
        '@@ -1,4 +1,4 @@',
        ' # Chat 11 bounded-write production smoke',
        ' ',
        ` run: ${fixture.suffix}`,
        '-status: staged',
        '+status: verified',
        '',
      ].join('\n'),
    }, 'file-patch')
    assert(patched.operation_id === operationId && patched.result?.amended === true, 'Patch did not amend one operation')
    checks.one_file_create_and_patch = true

    stage = 'owner_diff_approval'
    const approved = await ownerRequest('owner final diff approval', `/api/approvals/${operationId}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approved',
        actor: 'github-actions-production-owner',
        idempotency_key: idempotency(fixture.runKey, 'final-diff-approval'),
      }),
    })
    assert(approved.status === 'approved' && approved.changes?.length === 1, 'Final diff approval mismatch')
    assert(approved.changes[0].path === fixture.path, 'Approved path mismatch')
    checks.owner_final_diff_approved = true

    stage = 'commit_push'
    const committed = await call('repository_commit', {
      project_id: 'bestcode',
      operation_id: operationId,
      message: 'Add Chat 11 bounded-write smoke evidence',
    }, 'commit')
    commitSha = fullSha(committed.result?.commit_sha)
    await expectDenied('second_commit', 'repository_commit', {
      project_id: 'bestcode',
      operation_id: operationId,
    }, { idempotency: 'deny-second-commit' }, ['OPERATION_LIMIT_EXCEEDED'])
    await call('repository_push', { project_id: 'bestcode', operation_id: operationId }, 'push')
    checks.one_commit_and_push = true

    stage = 'ci'
    const build = await call('build_start', {
      project_id: 'bestcode',
      branch: fixture.branch,
      operation_id: operationId,
    }, 'build-start')
    const testRun = await call('test_start', {
      project_id: 'bestcode',
      branch: fixture.branch,
      operation_id: operationId,
    }, 'test-start')
    const [buildResult, testResult] = await Promise.all([
      waitTask('build', build.task_id),
      waitTask('test', testRun.task_id),
    ])
    checks.approved_build_and_test_passed = true

    stage = 'draft_pr'
    const pullRequest = await call('repository_create_pull_request', {
      project_id: 'bestcode',
      operation_id: operationId,
      title: `Chat 11 bounded-write smoke ${fixture.suffix}`,
      body: 'Synthetic protected production smoke. This draft PR is closed and its exact branch is deleted during cleanup.',
      draft: true,
    }, 'draft-pr')
    prNumber = Number(pullRequest.result?.number)
    assert(Number.isSafeInteger(prNumber) && prNumber > 0 && pullRequest.result?.draft === true, 'Draft PR evidence missing')
    await call('pull_request_status', { project_id: 'bestcode', number: prNumber })
    await expectDenied('second_pull_request', 'repository_create_pull_request', {
      project_id: 'bestcode',
      operation_id: operationId,
    }, { idempotency: 'deny-second-pr' }, ['OPERATION_LIMIT_EXCEEDED'])
    checks.one_draft_pr_and_status_read = true

    stage = 'mission_progress'
    await call('mission_task_progress_append', {
      project_id: 'bestcode',
      mission_id: fixture.missionId,
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token,
      expected_version: executionState.version,
      event: {
        event_id: deterministicId(fixture.runKey, 'event-tests-passed'),
        kind: 'tests_passed',
        message: 'The approved build and test workflows passed.',
      },
    }, 'progress-tests-passed')
    const currentExecution = await ownerRequest('execution refresh', `/api/mission-executions/${fixture.missionId}`)
    executionState = currentExecution

    stage = 'mission_result'
    await call('mission_task_result_submit', {
      project_id: 'bestcode',
      mission_id: fixture.missionId,
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token,
      expected_version: executionState.version,
      delivery_operation_id: operationId,
      expected_commit_sha: commitSha,
      draft_pr_number: prNumber,
      result: {
        summary: 'Completed the isolated Chat 11 bounded-write production smoke.',
        completed_work: ['Created and amended one scoped file through the actual MCP connector.'],
        changed_files: [fixture.path],
        test_results: [
          `build:${buildResult.result?.conclusion}`,
          `test:${testResult.result?.conclusion}`,
        ],
        evidence_references: [
          `operation:${operationId}`,
          `commit:${commitSha}`,
          `draft-pr:${prNumber}`,
        ],
        unresolved_issues: [],
        deviations: [],
        decisions_required: [],
        suggested_next_action: 'Close the synthetic draft PR and delete only its exact smoke branch.',
      },
    }, 'mission-result')
    checks.authoritative_result_submitted = true

    stage = 'terminal_revocation'
    const credential = await ownerRequest('credential status', `/api/bounded-write/credentials/${credentialId}`)
    assert(credential.credential?.status === 'revoked', 'Terminal result did not revoke credential')
    cleanup.credential_revoked = true
    await expectDenied('revoked_credential', 'project_get', { project_id: 'bestcode' }, {}, ['INVALID_BOUNDED_WRITE_CREDENTIAL'])
    checks.terminal_auto_revoke = true
  } catch (error) {
    failure = { stage, message: sanitize(error, secrets) }
  } finally {
    cleanup.attempted = missionCreated || Boolean(prNumber) || Boolean(credentialId)
    if (credentialId && !cleanup.credential_revoked) {
      try {
        const revoked = await ownerRequest('credential cleanup', `/api/bounded-write/credentials/${credentialId}/revoke`, {
          method: 'POST',
        })
        cleanup.credential_revoked = revoked.credential?.status === 'revoked'
      } catch (error) {
        cleanup.errors.push({ stage: 'credential_revoke', message: sanitize(error, secrets) })
      }
    }
    if (prNumber) {
      try {
        await githubRequest('draft PR cleanup', `/pulls/${prNumber}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed' }),
        })
        cleanup.pull_request_closed = true
      } catch (error) {
        cleanup.errors.push({ stage: 'pull_request_close', message: sanitize(error, secrets) })
      }
    }
    if (branchCreated) {
      try {
        const encodedRef = fixture.branch.split('/').map(encodeURIComponent).join('/')
        await githubRequest('smoke branch cleanup', `/git/refs/heads/${encodedRef}`, { method: 'DELETE' })
        cleanup.branch_deleted = true
      } catch (error) {
        const message = sanitize(error, secrets)
        if (/HTTP 404/.test(message)) cleanup.branch_deleted = true
        else cleanup.errors.push({ stage: 'branch_delete', message })
      }
    }
    if (executionCreated && !executionState?.cancelled_at) {
      try {
        executionState = await ownerRequest('execution cleanup read', `/api/mission-executions/${fixture.missionId}`)
        if (!executionState.cancelled_at) {
          await command('mission_execution_cancel', 'owner', 'cleanup-execution', {
            reason: 'Chat 11 isolated bounded-write smoke cleanup complete.',
          })
        }
        cleanup.execution_cancelled = Boolean(executionState?.cancelled_at)
      } catch (error) {
        cleanup.errors.push({ stage: 'execution_cancel', message: sanitize(error, secrets) })
      }
    }
    if (missionCreated) {
      try {
        const mission = await ownerRequest('mission cleanup read', `/api/missions/${fixture.missionId}`)
        if (mission.lifecycle !== 'cancelled') {
          const cancelled = await ownerRequest('mission cleanup transition', `/api/missions/${fixture.missionId}/transition`, {
            method: 'POST',
            body: JSON.stringify({
              expected_context_version: mission.context_version,
              lifecycle: 'cancelled',
            }),
          })
          cleanup.mission_cancelled = cancelled.lifecycle === 'cancelled'
        } else {
          cleanup.mission_cancelled = true
        }
      } catch (error) {
        cleanup.errors.push({ stage: 'mission_cancel', message: sanitize(error, secrets) })
      }
    }
  }

  const success = !failure &&
    cleanup.credential_revoked &&
    cleanup.execution_cancelled &&
    cleanup.mission_cancelled &&
    cleanup.pull_request_closed &&
    cleanup.branch_deleted &&
    cleanup.errors.length === 0
  const evidence = {
    evidence_id: `ev_chat11_bounded_write_${fixture.suffix}`,
    schema_version: 1,
    type: 'chat11_bounded_write_production_smoke',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/chat11-bounded-write-production-smoke.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository,
      source_branch: 'main',
      source_sha: fixture.baseSha,
      mission_id: fixture.missionId,
      plan_id: fixture.planId,
      task_id: fixture.taskId,
      attempt_id: fixture.attemptId,
      lease_id: fixture.leaseId,
      smoke_branch: fixture.branch,
      changed_files: operationId ? [fixture.path] : [],
      operation_id: operationId || null,
      commit_sha: commitSha || null,
      draft_pr_number: prNumber || null,
    },
    execution: {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      conclusion: success ? 'success' : 'failure',
      failure,
    },
    checks,
    denials,
    cleanup,
    security: {
      owner_secret_source: 'github-production-environment',
      bounded_secret_one_time_only: true,
      secret_value_persisted: false,
      sensitive_header_persisted: false,
      exact_smoke_resources_only: true,
      old_agent_branches_touched: false,
      merge_available: false,
      deploy_available: false,
      rollback_available: false,
    },
  }
  assertEvidenceSafe(evidence, secrets)
  return evidence
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? 'end'}`)
    result[key.slice(2)] = value
  }
  return result
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const ownerToken = bounded(process.env.BESTCODE_AUTH_TOKEN, 4096)
  const githubToken = bounded(process.env.GITHUB_TOKEN, 4096)
  const output = resolve(args.output ?? 'artifacts/chat11-bounded-write-production-smoke.json')
  let evidence
  try {
    evidence = await runBoundedWriteProductionSmoke({
      backendUrl: args['backend-url'] ?? process.env.BESTCODE_BACKEND_URL,
      ownerToken,
      githubToken,
      repository: args.repository ?? process.env.GITHUB_REPOSITORY,
      expectedSha: args['expected-sha'] ?? process.env.GITHUB_SHA,
      runKey: args['run-key'] ?? `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}`,
    })
  } catch (error) {
    evidence = {
      schema_version: 1,
      type: 'chat11_bounded_write_production_smoke',
      execution: {
        completed_at: new Date().toISOString(),
        conclusion: 'failure',
        failure: { stage: 'controller', message: sanitize(error, [ownerToken, githubToken]) },
      },
      security: { secret_value_persisted: false, sensitive_header_persisted: false },
    }
  }
  assertEvidenceSafe(evidence, [ownerToken, githubToken])
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(`BestCode Chat 11 bounded-write production smoke: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${output}`)
  if (evidence.execution.conclusion !== 'success') process.exitCode = 1
}

const isEntryPoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isEntryPoint) await runCli()
