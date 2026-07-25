#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  MCP_PROTOCOL_VERSION,
  SMOKE_AGENT_ID,
  SMOKE_APPROVAL,
  SMOKE_PROVIDER,
  assertEvidenceSafe,
  buildSmokeFixture,
} from './chat11-bounded-write-production-smoke.mjs'

export const SUPPLEMENTAL_DENIAL_KEYS = Object.freeze([
  'wrong_task',
  'stale_lease',
  'expired_credential',
  'second_push',
])

const SECRET_PATTERN = /(?:bcwrite_v1\.[A-Za-z0-9._-]+|Bearer\s+[A-Za-z0-9._~+/-]{8,}=?)/gi

function bounded(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
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

function idempotency(runKey, label) {
  return `chat11-denial-${label}-${sha256(runKey).slice(0, 24)}`.slice(0, 128)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sanitize(value, secrets = []) {
  let result = bounded(value instanceof Error ? value.message : String(value), 1000)
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[REDACTED]')
  return result
    .replace(SECRET_PATTERN, '[REDACTED]')
    .replace(/bearer\s+\S+/gi, '[REDACTED_CREDENTIAL]')
    .replace(/authorization/gi, '[REDACTED_HEADER]')
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

function structured(body) {
  return body?.result?.structuredContent ?? null
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

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

export function scenarioRunKey(runKey, label) {
  const safe = bounded(runKey, 60).replace(/[^A-Za-z0-9_-]/g, '-')
  const suffix = bounded(label, 30).replace(/[^A-Za-z0-9_-]/g, '-')
  if (!safe || !suffix) throw new Error('Scenario run key and label are required')
  return `${safe}-${suffix}`.slice(0, 60)
}

function createScenario(options, label) {
  const runKey = scenarioRunKey(options.runKey, label)
  const fixture = buildSmokeFixture(runKey, options.expectedSha, new Date().toISOString())
  const baseUrl = bounded(options.backendUrl, 300).replace(/\/$/, '')
  const ownerToken = bounded(options.ownerToken, 4096)
  const githubToken = bounded(options.githubToken, 4096)
  const repository = bounded(options.repository || 'enkhbat194/best-code-ide', 200)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const secrets = [ownerToken, githubToken]
  let state = null
  let credentialSecret = ''
  let credentialId = ''
  let branchCreated = false
  let missionCreated = false
  let executionCreated = false
  let rpcSequence = 1

  const ownerRequest = async (requestLabel, path, init = {}, expected = 200) => {
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
      throw new Error(`${requestLabel} HTTP ${response.status}: ${sanitize(body?.error ?? 'unexpected response', secrets)}`)
    }
    return body
  }

  const githubRequest = async (requestLabel, path, init = {}, expected = [200, 204]) => {
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
      throw new Error(`${requestLabel} HTTP ${response.status}: ${sanitize(body?.message ?? 'unexpected response', secrets)}`)
    }
    return response.status === 204 ? null : parseJson(response)
  }

  const command = async (name, actor, commandLabel, args = {}) => {
    const body = await ownerRequest(name, `/api/mission-executions/${fixture.missionId}/command`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotency(runKey, commandLabel),
        'X-BestCode-Agent-Id': actor,
      },
      body: JSON.stringify({
        command: name,
        project_id: 'bestcode',
        expected_version: state?.version ?? 0,
        ...args,
      }),
    })
    state = body.state
    return body
  }

  const rpc = async (name, args = {}, rpcOptions = {}) => {
    const key = rpcOptions.idempotency ? idempotency(runKey, rpcOptions.idempotency) : ''
    const toolArguments = key && name.startsWith('mission_') ? { ...args, idempotency_key: key } : args
    const response = await fetchImpl(`${baseUrl}/mcp/subscription?project_id=bestcode`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        Authorization: `Bearer ${credentialSecret}`,
        'X-BestCode-Agent-Id': SMOKE_AGENT_ID,
        'X-BestCode-Agent-Provider': SMOKE_PROVIDER,
        'X-BestCode-Request-Id': `chat11-denial-${label}-${rpcSequence}`,
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcSequence++,
        method: 'tools/call',
        params: { name, arguments: toolArguments },
      }),
    })
    const body = await parseJson(response)
    return { status: response.status, body, envelope: structured(body), code: codeFrom(body) }
  }

  const call = async (name, args, key) => {
    const result = await rpc(name, args, key ? { idempotency: key } : {})
    if (result.status !== 200 || result.body?.error || result.envelope?.ok !== true) {
      throw new Error(`${name} failed closed: ${result.code}`)
    }
    return result.envelope
  }

  const denied = async (name, args, key, accepted = []) => {
    const result = await rpc(name, args, key ? { idempotency: key } : {})
    const failedClosed = result.status >= 400 || Boolean(result.body?.error) || result.envelope?.ok === false
    assert(failedClosed, `${name} did not fail closed`)
    if (accepted.length) assert(accepted.some((code) => result.code.includes(code)), `${name} denial code mismatch: ${result.code}`)
    return { denied: true, status: result.status, reason_code: result.code }
  }

  const setup = async ({ leaseTtl = 900, credentialTtl = 1800, allowedTools, limits }) => {
    assert(ownerToken, 'BESTCODE_AUTH_TOKEN is missing')
    assert(githubToken, 'GITHUB_TOKEN is missing')
    assert(/^https:\/\//.test(baseUrl), 'Production backend URL must use HTTPS')

    const mission = await ownerRequest('mission create', '/api/missions', {
      method: 'POST',
      body: JSON.stringify({
        mission_id: fixture.missionId,
        project_id: 'bestcode',
        title: `Chat 11 production denial ${label}`,
      }),
    }, 201)
    missionCreated = true
    assert(mission.project_id === 'bestcode', 'Mission project mismatch')

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
      ttl_seconds: leaseTtl,
    })
    const lease = state.leases.find((item) => item.lease_id === fixture.leaseId)
    assert(lease?.fencing_token === 1, 'Lease fencing token mismatch')
    await command('mission_task_progress_append', SMOKE_AGENT_ID, 'progress-started', {
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token,
      event: {
        event_id: deterministicId(runKey, 'event-started'),
        kind: 'started',
        message: `Started ${label} denial scenario.`,
      },
    })
    await command('mission_task_progress_append', SMOKE_AGENT_ID, 'progress-waiting', {
      task_id: fixture.taskId,
      lease_id: fixture.leaseId,
      fencing_token: lease.fencing_token,
      event: {
        event_id: deterministicId(runKey, 'event-waiting'),
        kind: 'waiting_for_approval',
        message: `Waiting for ${label} owner gate.`,
      },
    })
    await command('mission_execution_approve_gate', 'owner', 'owner-approve-gate', {
      task_id: fixture.taskId,
      approval_operation_id: SMOKE_APPROVAL,
    })

    const issued = await ownerRequest('credential issue', '/api/bounded-write/credentials', {
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
        allowed_tools: allowedTools,
        allowed_paths: ['docs/smoke/**'],
        expires_in_seconds: credentialTtl,
        limits,
        idempotency_namespace: `chat11-denial-${fixture.suffix}`,
        approval_record_id: SMOKE_APPROVAL,
      }),
    }, 201)
    credentialSecret = bounded(issued.secret, 4096)
    credentialId = bounded(issued.credential?.credential_id, 64)
    secrets.push(credentialSecret)
    assert(/^bcwrite_v1\./.test(credentialSecret) && credentialId, 'Credential issue failed')
    return { lease, credential: issued.credential }
  }

  const cleanup = async () => {
    const proof = {
      credential_revoked: false,
      execution_cancelled: false,
      mission_cancelled: false,
      branch_deleted: !branchCreated,
      errors: [],
    }
    if (credentialId) {
      try {
        const revoked = await ownerRequest('credential cleanup', `/api/bounded-write/credentials/${credentialId}/revoke`, { method: 'POST' })
        proof.credential_revoked = revoked.credential?.status === 'revoked'
      } catch (error) {
        proof.errors.push({ stage: 'credential_revoke', message: sanitize(error, secrets) })
      }
    }
    if (branchCreated) {
      try {
        const encodedRef = fixture.branch.split('/').map(encodeURIComponent).join('/')
        await githubRequest('branch cleanup', `/git/refs/heads/${encodedRef}`, { method: 'DELETE' })
        proof.branch_deleted = true
      } catch (error) {
        const message = sanitize(error, secrets)
        if (/HTTP 404/.test(message)) proof.branch_deleted = true
        else proof.errors.push({ stage: 'branch_delete', message })
      }
    }
    if (executionCreated) {
      try {
        state = await ownerRequest('execution cleanup read', `/api/mission-executions/${fixture.missionId}`)
        if (!state.cancelled_at) {
          await command('mission_execution_cancel', 'owner', 'cleanup-execution', {
            reason: `Chat 11 ${label} denial cleanup complete.`,
          })
        }
        proof.execution_cancelled = Boolean(state?.cancelled_at)
      } catch (error) {
        proof.errors.push({ stage: 'execution_cancel', message: sanitize(error, secrets) })
      }
    }
    if (missionCreated) {
      try {
        const mission = await ownerRequest('mission cleanup read', `/api/missions/${fixture.missionId}`)
        if (mission.lifecycle === 'cancelled') proof.mission_cancelled = true
        else {
          const cancelled = await ownerRequest('mission cleanup transition', `/api/missions/${fixture.missionId}/transition`, {
            method: 'POST',
            body: JSON.stringify({
              expected_context_version: mission.context_version,
              lifecycle: 'cancelled',
            }),
          })
          proof.mission_cancelled = cancelled.lifecycle === 'cancelled'
        }
      } catch (error) {
        proof.errors.push({ stage: 'mission_cancel', message: sanitize(error, secrets) })
      }
    }
    return proof
  }

  return {
    label,
    runKey,
    fixture,
    secrets,
    setup,
    call,
    denied,
    ownerRequest,
    githubRequest,
    cleanup,
    get state() { return state },
    get credentialId() { return credentialId },
    get credentialSecret() { return credentialSecret },
    markBranchCreated() { branchCreated = true },
  }
}

const DEFAULT_LIMITS = Object.freeze({
  max_operations: 20,
  max_changed_files: 1,
  max_total_changed_bytes: 4096,
  max_commits: 1,
  max_pushes: 1,
  max_pull_requests: 1,
})

export async function runSupplementalProductionDenials(options) {
  const startedAt = new Date().toISOString()
  const allSecrets = [options.ownerToken, options.githubToken]
  const denials = {}
  const cleanup = {}
  let releaseProof = null
  let failure = null

  const expiry = createScenario(options, 'expired-credential')
  const repository = createScenario(options, 'repository-limits')
  const stale = createScenario(options, 'stale-lease')
  const release = createScenario(options, 'lease-release')

  try {
    const expirySetup = await expiry.setup({
      leaseTtl: 900,
      credentialTtl: 300,
      allowedTools: ['project_get'],
      limits: DEFAULT_LIMITS,
    })
    allSecrets.push(...expiry.secrets)

    const repositorySetup = await repository.setup({
      allowedTools: [
        'repository_create_branch',
        'repository_write_file',
        'repository_commit',
        'repository_push',
        'mission_task_progress_append',
      ],
      limits: DEFAULT_LIMITS,
    })
    allSecrets.push(...repository.secrets)

    denials.wrong_task = await repository.denied('mission_task_progress_append', {
      project_id: 'bestcode',
      mission_id: repository.fixture.missionId,
      task_id: deterministicId(repository.runKey, 'wrong-task'),
      lease_id: repository.fixture.leaseId,
      fencing_token: repositorySetup.lease.fencing_token,
      expected_version: repository.state.version,
      event: {
        event_id: deterministicId(repository.runKey, 'wrong-task-event'),
        kind: 'context_loaded',
        message: 'Wrong task mutation must be denied.',
      },
    }, 'wrong-task', ['MISSION_TASK_ID_SCOPE'])

    await repository.call('repository_create_branch', {
      project_id: 'bestcode',
      name: repository.fixture.branch,
    }, 'branch-create')
    repository.markBranchCreated()
    const content = `# Chat 11 supplemental denial smoke\n\nrun: ${repository.fixture.suffix}\n`
    const staged = await repository.call('repository_write_file', {
      project_id: 'bestcode',
      branch: repository.fixture.branch,
      path: repository.fixture.path,
      content,
      expected_branch_head_sha: repository.fixture.baseSha,
      expected_old_hash: 'absent',
      title: 'Chat 11 supplemental second-push proof',
      summary: 'Create one isolated file solely to verify the push limit.',
    }, 'file-stage')
    const operationId = staged.operation_id
    const approved = await repository.ownerRequest('owner final diff approval', `/api/approvals/${operationId}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approved',
        actor: 'github-actions-production-owner',
        idempotency_key: idempotency(repository.runKey, 'final-diff-approval'),
      }),
    })
    assert(approved.status === 'approved', 'Supplemental final diff approval failed')
    await repository.call('repository_commit', {
      project_id: 'bestcode',
      operation_id: operationId,
      message: 'Add supplemental Chat 11 push-limit proof',
    }, 'commit')
    await repository.call('repository_push', { project_id: 'bestcode', operation_id: operationId }, 'push')
    denials.second_push = await repository.denied('repository_push', {
      project_id: 'bestcode',
      operation_id: operationId,
    }, 'second-push', ['OPERATION_LIMIT_EXCEEDED'])

    const staleSetup = await stale.setup({
      leaseTtl: 15,
      credentialTtl: 300,
      allowedTools: ['mission_task_progress_append'],
      limits: DEFAULT_LIMITS,
    })
    allSecrets.push(...stale.secrets)
    const leaseDeadline = Date.parse(staleSetup.lease.expires_at) + 1500
    if (Date.now() < leaseDeadline) await wait(leaseDeadline - Date.now())
    denials.stale_lease = await stale.denied('mission_task_progress_append', {
      project_id: 'bestcode',
      mission_id: stale.fixture.missionId,
      task_id: stale.fixture.taskId,
      lease_id: stale.fixture.leaseId,
      fencing_token: staleSetup.lease.fencing_token,
      expected_version: stale.state.version,
      event: {
        event_id: deterministicId(stale.runKey, 'stale-lease-event'),
        kind: 'context_loaded',
        message: 'Expired lease mutation must be denied.',
      },
    }, 'stale-lease')

    const releaseSetup = await release.setup({
      leaseTtl: 900,
      credentialTtl: 300,
      allowedTools: ['mission_task_lease_release'],
      limits: DEFAULT_LIMITS,
    })
    allSecrets.push(...release.secrets)
    await release.call('mission_task_lease_release', {
      project_id: 'bestcode',
      mission_id: release.fixture.missionId,
      task_id: release.fixture.taskId,
      lease_id: release.fixture.leaseId,
      fencing_token: releaseSetup.lease.fencing_token,
      expected_version: release.state.version,
      release_reason: 'supplemental_production_proof',
    }, 'lease-release')
    const releasedState = await release.ownerRequest('released execution read', `/api/mission-executions/${release.fixture.missionId}`)
    const releasedLease = releasedState.leases.find((item) => item.lease_id === release.fixture.leaseId)
    const releasedCredential = await release.ownerRequest('released credential status', `/api/bounded-write/credentials/${release.credentialId}`)
    assert(releasedLease?.released_at, 'Explicit lease release timestamp missing')
    assert(releasedLease?.release_reason === 'supplemental_production_proof', 'Explicit lease release reason mismatch')
    assert(releasedCredential.credential?.status === 'revoked', 'Lease release did not revoke credential')
    releaseProof = {
      released: true,
      release_reason: releasedLease.release_reason,
      terminal_credential_status: releasedCredential.credential.status,
    }

    const expiryDeadline = Date.parse(expirySetup.credential.expires_at) + 1500
    if (Date.now() < expiryDeadline) await wait(expiryDeadline - Date.now())
    denials.expired_credential = await expiry.denied('project_get', { project_id: 'bestcode' }, null, ['INVALID_BOUNDED_WRITE_CREDENTIAL'])
  } catch (error) {
    failure = { message: sanitize(error, allSecrets) }
  } finally {
    for (const scenario of [repository, stale, release, expiry]) {
      cleanup[scenario.label] = await scenario.cleanup()
    }
  }

  const allDenialsPassed = SUPPLEMENTAL_DENIAL_KEYS.every((key) => denials[key]?.denied === true)
  const allCleanupPassed = Object.values(cleanup).every((item) =>
    item.credential_revoked && item.execution_cancelled && item.mission_cancelled && item.branch_deleted && item.errors.length === 0)
  const success = !failure && allDenialsPassed && Boolean(releaseProof?.released) && allCleanupPassed
  const evidence = {
    evidence_id: `ev_chat11_bounded_denials_${sha256(options.runKey).slice(0, 16)}`,
    schema_version: 1,
    type: 'chat11_bounded_write_production_denials',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/chat11-bounded-write-production-denials.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: bounded(options.repository || 'enkhbat194/best-code-ide', 200),
      source_branch: 'main',
      source_sha: bounded(options.expectedSha, 64),
      scenario_missions: [expiry, repository, stale, release].map((scenario) => scenario.fixture.missionId),
      scenario_branches: [repository.fixture.branch],
    },
    execution: {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      conclusion: success ? 'success' : 'failure',
      failure,
    },
    denials,
    lease_release_proof: releaseProof,
    cleanup,
    security: {
      secret_value_persisted: false,
      sensitive_header_persisted: false,
      exact_synthetic_resources_only: true,
      old_agent_branches_touched: false,
    },
  }
  assertEvidenceSafe(evidence, allSecrets)
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
  const output = resolve(args.output ?? 'artifacts/chat11-bounded-write-production-denials.json')
  let evidence
  try {
    evidence = await runSupplementalProductionDenials({
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
      type: 'chat11_bounded_write_production_denials',
      execution: {
        completed_at: new Date().toISOString(),
        conclusion: 'failure',
        failure: { message: sanitize(error, [ownerToken, githubToken]) },
      },
      security: { secret_value_persisted: false, sensitive_header_persisted: false },
    }
  }
  assertEvidenceSafe(evidence, [ownerToken, githubToken])
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(`BestCode Chat 11 supplemental production denials: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${output}`)
  if (evidence.execution.conclusion !== 'success') process.exitCode = 1
}

const isEntryPoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isEntryPoint) await runCli()
