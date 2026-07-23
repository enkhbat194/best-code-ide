#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MCP_PROTOCOL_VERSION = '2025-11-25'
export const REQUIRED_SUBSCRIPTION_TOOLS = [
  'projects_list',
  'project_get',
  'brain_search',
  'brain_export_summary',
  'mission_get',
  'mission_context_get',
  'repository_status',
  'repository_read_file',
  'repository_search',
  'pull_request_status',
  'deployment_status',
  'handoff_packet_build',
]

export const MUTATION_TOOLS = [
  'repository_create_branch',
  'repository_write_file',
  'repository_apply_patch',
  'repository_delete_file',
  'repository_delete_branch',
  'repository_commit',
  'repository_push',
  'repository_create_pull_request',
  'build_start',
  'test_start',
  'task_cancel',
  'deployment_start',
  'rollback_request',
  'approval_decide',
  'mission_create',
  'mission_transition',
  'mission_lease',
  'mission_mutate',
  'project_task_start',
  'project_task_update',
  'project_handoff_record',
]

const SECRET_VALUE_PATTERN = /\bBearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/-]{8,}=?\b/gi

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function fullSha(value) {
  const sha = boundedText(value, 64).toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected SHA must be a full 40-character commit SHA')
  return sha
}

function endpointUrl(backendUrl) {
  const url = new URL('/mcp/subscription', backendUrl)
  url.searchParams.set('project_id', 'bestcode')
  if (url.pathname !== '/mcp/subscription') throw new Error('Subscription smoke must use /mcp/subscription')
  return url
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function sameStrings(left, right) {
  const a = sorted(left)
  const b = sorted(right)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sanitizeError(error, token) {
  let message = boundedText(error instanceof Error ? error.message : String(error), 1000)
  if (token) message = message.split(token).join('[REDACTED]')
  return message.replace(SECRET_VALUE_PATTERN, 'Bearer [REDACTED]')
}

export function assertNoSecretLeak(raw, token) {
  if (token && raw.includes(token)) throw new Error('Production response contained the authentication secret')
  SECRET_VALUE_PATTERN.lastIndex = 0
  if (SECRET_VALUE_PATTERN.test(raw)) throw new Error('Production response contained an unredacted Bearer value')
}

function assertToolList(tools) {
  const names = tools.map((tool) => boundedText(tool?.name, 160)).filter(Boolean)
  if (!sameStrings(names, REQUIRED_SUBSCRIPTION_TOOLS)) {
    throw new Error('Subscription tools/list did not match the locked read-only tool set')
  }
  const advertisedMutations = names.filter((name) => MUTATION_TOOLS.includes(name))
  if (advertisedMutations.length > 0) throw new Error('Subscription tools/list advertised mutation tools')
  for (const tool of tools) {
    if (tool?.annotations?.readOnlyHint !== true) throw new Error(`Subscription tool ${tool?.name ?? 'unknown'} is not read-only`)
    if (tool?._meta?.['bestcode/safetyClass'] !== 'read-only') {
      throw new Error(`Subscription tool ${tool?.name ?? 'unknown'} has an invalid safety class`)
    }
  }
  return names
}

function structuredEnvelope(response, expectedTool, expectedRequestId) {
  const result = response?.result
  if (!isObject(result) || !isObject(result.structuredContent)) {
    throw new Error(`${expectedTool} did not return structuredContent`)
  }
  const envelope = result.structuredContent
  if (envelope.request_id !== expectedRequestId) throw new Error(`${expectedTool} request ID mismatch`)
  if (envelope.project_scope !== 'bestcode') throw new Error(`${expectedTool} project scope mismatch`)
  if (!isObject(envelope.audit)) throw new Error(`${expectedTool} audit metadata is missing`)
  if (envelope.audit.event !== 'bestcode_tool_execution') throw new Error(`${expectedTool} audit event is invalid`)
  if (envelope.audit.profile !== 'subscription-readonly') throw new Error(`${expectedTool} audit profile is invalid`)
  if (envelope.audit.transport !== 'mcp') throw new Error(`${expectedTool} audit transport is invalid`)
  if (envelope.audit.tool !== expectedTool) throw new Error(`${expectedTool} audit tool mismatch`)
  return envelope
}

async function rpc(fetchImpl, endpoint, token, method, params, requestId, id) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'X-BestCode-Request-Id': requestId,
        'X-BestCode-Agent-Id': 'github-actions-production-smoke',
        'X-BestCode-Agent-Provider': 'provider-neutral',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text()
  assertNoSecretLeak(raw, token)
  if (response.status !== 200) throw new Error(`MCP ${method} returned HTTP ${response.status}`)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error(`MCP ${method} returned invalid JSON`)
  }
  if (body?.jsonrpc !== '2.0' || body?.id !== id) throw new Error(`MCP ${method} returned an invalid JSON-RPC envelope`)
  if (body.error) throw new Error(`MCP ${method} returned JSON-RPC error ${body.error.code ?? 'unknown'}`)
  return { body, raw }
}

function requestId(label) {
  return `mcp-prod-${label}-${crypto.randomUUID()}`
}

function assertDenied(envelope, code, tool) {
  if (envelope.ok !== false || envelope.status !== 'failed') throw new Error(`${tool} denial did not fail closed`)
  if (envelope.error?.code !== code) throw new Error(`${tool} denial code mismatch`)
  if (envelope.audit?.outcome !== 'denied') throw new Error(`${tool} denial audit outcome mismatch`)
}

function assertReadOnlyEnvelope(envelope, tool) {
  if (envelope.ok !== true || envelope.status !== 'completed') throw new Error(`${tool} did not complete`)
  if (envelope.safety_class !== 'read-only') throw new Error(`${tool} did not return read-only safety metadata`)
  if (envelope.audit?.outcome !== 'completed') throw new Error(`${tool} audit outcome mismatch`)
}

export async function runMcpProductionSmoke({
  backendUrl,
  token,
  expectedSha,
  fetchImpl = globalThis.fetch,
  checkedAt = new Date().toISOString(),
}) {
  if (!boundedText(token, 4096)) throw new Error('BESTCODE_AUTH_TOKEN is missing')
  const sha = fullSha(expectedSha)
  const endpoint = endpointUrl(backendUrl)
  const rawResponses = []

  const initializeId = requestId('initialize')
  const initialize = await rpc(fetchImpl, endpoint, token, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'bestcode-production-smoke', version: '1.0.0' },
  }, initializeId, 1)
  rawResponses.push(initialize.raw)
  const initialized = initialize.body.result
  if (initialized?.protocolVersion !== MCP_PROTOCOL_VERSION) throw new Error('MCP protocol negotiation mismatch')
  if (initialized?.capabilities?.tools?.listChanged !== false) throw new Error('MCP tools capability negotiation mismatch')
  if (initialized?.serverInfo?.name !== 'bestcode-subscription-agent-gateway') {
    throw new Error('MCP subscription server identity mismatch')
  }

  const listId = requestId('tools-list')
  const listed = await rpc(fetchImpl, endpoint, token, 'tools/list', {}, listId, 2)
  rawResponses.push(listed.raw)
  const tools = Array.isArray(listed.body.result?.tools) ? listed.body.result.tools : []
  const toolNames = assertToolList(tools)

  const projectId = requestId('project-get')
  const project = await rpc(fetchImpl, endpoint, token, 'tools/call', {
    name: 'project_get',
    arguments: { project_id: 'bestcode' },
  }, projectId, 3)
  rawResponses.push(project.raw)
  const projectEnvelope = structuredEnvelope(project.body, 'project_get', projectId)
  assertReadOnlyEnvelope(projectEnvelope, 'project_get')
  if (projectEnvelope.project_id !== 'bestcode') throw new Error('project_get returned the wrong project')

  const crossId = requestId('cross-project')
  const cross = await rpc(fetchImpl, endpoint, token, 'tools/call', {
    name: 'project_get',
    arguments: { project_id: 'czech-app' },
  }, crossId, 4)
  rawResponses.push(cross.raw)
  const crossEnvelope = structuredEnvelope(cross.body, 'project_get', crossId)
  assertDenied(crossEnvelope, 'CROSS_PROJECT_ACCESS_DENIED', 'project_get')

  const traversalResults = []
  for (const [index, path] of ['../secret.txt', '.git/config'].entries()) {
    const traversalId = requestId(`path-${index + 1}`)
    const traversal = await rpc(fetchImpl, endpoint, token, 'tools/call', {
      name: 'repository_read_file',
      arguments: { project_id: 'bestcode', path },
    }, traversalId, 5 + index)
    rawResponses.push(traversal.raw)
    const envelope = structuredEnvelope(traversal.body, 'repository_read_file', traversalId)
    assertDenied(envelope, 'INVALID_REPOSITORY_PATH', 'repository_read_file')
    traversalResults.push(envelope.error.code)
  }

  const mutationId = requestId('mutation-denial')
  const mutation = await rpc(fetchImpl, endpoint, token, 'tools/call', {
    name: 'repository_create_branch',
    arguments: { project_id: 'bestcode', name: 'agent/forbidden-production-smoke' },
  }, mutationId, 7)
  rawResponses.push(mutation.raw)
  const mutationEnvelope = structuredEnvelope(mutation.body, 'repository_create_branch', mutationId)
  assertDenied(mutationEnvelope, 'TOOL_DISABLED_FOR_PROFILE', 'repository_create_branch')

  const handoffArguments = {
    project_id: 'bestcode',
    branch: 'main',
    objective: 'Verify the Chat 7 subscription MCP production closeout.',
    completed_work: ['PR #70 merged and production read-only gateway smoke executed.'],
    changed_files: [],
    test_status: {
      state: 'production_smoke',
      summary: 'Authenticated read-only MCP smoke.',
      evidence_references: ['github-actions-production-smoke'],
    },
    unresolved_issues: [],
    decisions_required: [],
    safety_constraints: ['No production mutation.', 'No secret disclosure.'],
    next_exact_action: 'Record Chat 7 production owner closeout.',
    source_references: [`main:${sha}`],
    evidence_references: ['cloudflare-release-integrity'],
  }

  const handoffPackets = []
  for (const [index, id] of [8, 9].entries()) {
    const handoffId = requestId(`handoff-${index + 1}`)
    const handoff = await rpc(fetchImpl, endpoint, token, 'tools/call', {
      name: 'handoff_packet_build',
      arguments: handoffArguments,
    }, handoffId, id)
    rawResponses.push(handoff.raw)
    const envelope = structuredEnvelope(handoff.body, 'handoff_packet_build', handoffId)
    assertReadOnlyEnvelope(envelope, 'handoff_packet_build')
    const packet = envelope.result?.packet
    if (!isObject(packet)) throw new Error('handoff_packet_build did not return a packet')
    if (packet.base_sha !== sha) throw new Error('handoff packet base SHA does not match exact main')
    if (!/^[a-f0-9]{64}$/.test(String(packet.packet_hash ?? ''))) throw new Error('handoff packet hash is invalid')
    handoffPackets.push(packet)
  }
  if (JSON.stringify(handoffPackets[0]) !== JSON.stringify(handoffPackets[1])) {
    throw new Error('handoff packet is not deterministic')
  }

  for (const raw of rawResponses) assertNoSecretLeak(raw, token)

  const evidence = {
    evidence_id: `ev_mcp_closeout_${Date.now()}`,
    schema_version: 1,
    type: 'production_smoke',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/mcp-production-smoke.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: 'enkhbat194/best-code-ide',
      branch: 'main',
      commit_sha: sha,
      endpoint: `${endpoint.origin}${endpoint.pathname}?project_id=bestcode`,
    },
    execution: {
      checked_at: checkedAt,
      conclusion: 'success',
    },
    protocol: {
      negotiated_version: initialized.protocolVersion,
      tools_capability: initialized.capabilities.tools,
      server_name: initialized.serverInfo.name,
    },
    tools: {
      advertised: toolNames,
      exact_read_only_set: true,
      mutation_tools_advertised: [],
      direct_mutation_call_denied: true,
    },
    checks: {
      project_get_completed: true,
      cross_project_fail_closed: true,
      path_traversal_fail_closed: traversalResults,
      result_audit_metadata_present: true,
      handoff_deterministic: true,
      handoff_packet_hash: handoffPackets[0].packet_hash,
      handoff_base_sha: handoffPackets[0].base_sha,
    },
    security: {
      authentication: 'production_environment_secret',
      redaction_applied: true,
      token_value_present: false,
      unredacted_bearer_value_present: false,
      raw_responses_persisted: false,
      production_mutation_performed: false,
    },
  }
  assertNoSecretLeak(JSON.stringify(evidence), token)
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

function failureEvidence(expectedSha, error, token) {
  return {
    evidence_id: `ev_mcp_closeout_${Date.now()}`,
    schema_version: 1,
    type: 'production_smoke',
    project_id: 'bestcode',
    scope: {
      repository: process.env.GITHUB_REPOSITORY || 'enkhbat194/best-code-ide',
      branch: 'main',
      commit_sha: /^[a-f0-9]{40}$/i.test(expectedSha ?? '') ? expectedSha.toLowerCase() : null,
      endpoint: '/mcp/subscription?project_id=bestcode',
    },
    execution: {
      checked_at: new Date().toISOString(),
      conclusion: 'failure',
      error: sanitizeError(error, token),
    },
    security: {
      authentication: 'production_environment_secret',
      redaction_applied: true,
      token_value_present: false,
      raw_responses_persisted: false,
      production_mutation_performed: false,
    },
  }
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const token = boundedText(process.env.BESTCODE_AUTH_TOKEN, 4096)
  const backendUrl = args['backend-url'] ?? process.env.BESTCODE_BACKEND_URL
  const expectedSha = args['expected-sha'] ?? process.env.GITHUB_SHA
  const output = args.output ?? 'artifacts/mcp-production-smoke.json'
  let evidence
  try {
    if (!backendUrl) throw new Error('BESTCODE_BACKEND_URL is missing')
    evidence = await runMcpProductionSmoke({ backendUrl, token, expectedSha })
  } catch (error) {
    evidence = failureEvidence(expectedSha, error, token)
  }
  const destination = await writeEvidence(output, evidence)
  console.log(`BestCode subscription MCP production smoke: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${destination}`)
  if (evidence.execution.conclusion !== 'success') {
    console.error(evidence.execution.error)
    process.exitCode = 1
  }
}

const isEntryPoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isEntryPoint) await runCli()
