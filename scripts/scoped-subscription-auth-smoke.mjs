#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MCP_PROTOCOL_VERSION = '2025-11-25'
export const REQUIRED_TOOLS = [
  'projects_list', 'project_get', 'brain_search', 'brain_export_summary',
  'mission_get', 'mission_context_get', 'repository_status', 'repository_read_file',
  'repository_search', 'pull_request_status', 'deployment_status', 'handoff_packet_build',
]
const SECRET_PATTERN = /\bbcsub_v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{32,128}\b/gi

function text(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function sanitize(value) {
  if (typeof value === 'string') return value.replace(SECRET_PATTERN, '[REDACTED_SCOPED_CREDENTIAL]')
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    /(authorization|secret|token|hash)/i.test(key) ? `${key}_redacted` : key,
    /(authorization|secret|token|hash)/i.test(key) ? '[REDACTED]' : sanitize(nested),
  ]))
}

export function assertNoScopedSecret(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  SECRET_PATTERN.lastIndex = 0
  if (SECRET_PATTERN.test(raw)) throw new Error('Scoped credential leaked into evidence')
}

async function requestJson(fetchImpl, url, init, expectedStatus) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let response
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text()
  if (response.status !== expectedStatus) throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}`)
  let body = null
  try { body = raw ? JSON.parse(raw) : null } catch { throw new Error(`${new URL(url).pathname} returned invalid JSON`) }
  return { body, raw, status: response.status }
}

async function rpc(fetchImpl, url, token, id, method, params, expectedStatus = 200) {
  return requestJson(fetchImpl, url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'X-BestCode-Request-Id': `scoped-smoke-${id}`,
      'X-BestCode-Agent-Id': 'spoofed-smoke-agent',
      'X-BestCode-Agent-Provider': 'spoofed-provider',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  }, expectedStatus)
}

export async function runScopedSubscriptionAuthSmoke({
  backendUrl,
  ownerToken,
  projectId = 'bestcode',
  fetchImpl = globalThis.fetch,
  checkedAt = new Date().toISOString(),
}) {
  if (!text(ownerToken, 4096)) throw new Error('BESTCODE_AUTH_TOKEN is missing')
  const base = new URL(backendUrl)
  const credentialApi = new URL('/api/subscription/credentials', base)
  let credentialId = ''
  let scopedToken = ''
  const checks = []

  try {
    const created = await requestJson(fetchImpl, credentialApi, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
        'X-BestCode-Request-Id': `scoped-smoke-create-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        project_id: projectId,
        agent_name: 'github-actions-scoped-smoke',
        provider: 'provider-neutral',
        expires_in_seconds: 900,
        note: 'Manual production closeout smoke; revoke in same run',
      }),
    }, 201)
    scopedToken = text(created.body?.secret, 4096)
    credentialId = text(created.body?.credential?.credential_id, 80)
    if (!credentialId || !/^bcsub_v1\./.test(scopedToken)) throw new Error('Credential creation response is invalid')
    checks.push('credential_created_once')

    const endpoint = new URL('/mcp/subscription', base)
    endpoint.searchParams.set('project_id', projectId)
    const initialized = await rpc(fetchImpl, endpoint, scopedToken, 1, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'bestcode-scoped-smoke', version: '1.0.0' },
    })
    if (initialized.body?.result?.serverInfo?.name !== 'bestcode-subscription-agent-gateway') throw new Error('Initialize server identity mismatch')
    checks.push('initialize')

    const listed = await rpc(fetchImpl, endpoint, scopedToken, 2, 'tools/list', {})
    const names = (listed.body?.result?.tools ?? []).map((tool) => tool.name).sort()
    if (JSON.stringify(names) !== JSON.stringify([...REQUIRED_TOOLS].sort())) throw new Error('Read-only tool set mismatch')
    checks.push('tools_list_exact')

    const project = await rpc(fetchImpl, endpoint, scopedToken, 3, 'tools/call', {
      name: 'project_get', arguments: { project_id: projectId },
    })
    const envelope = project.body?.result?.structuredContent
    if (envelope?.ok !== true || envelope?.audit?.credential_id !== credentialId) throw new Error('Scoped project_get audit mismatch')
    if (envelope?.actor?.id !== 'github-actions-scoped-smoke') throw new Error('Credential identity was not authoritative')
    checks.push('project_get')

    const wrongProject = new URL(endpoint)
    wrongProject.searchParams.set('project_id', `${projectId}-wrong`)
    await rpc(fetchImpl, wrongProject, scopedToken, 4, 'initialize', {}, 401)
    checks.push('wrong_project_denied')

    const fullEndpoint = new URL('/mcp', base)
    fullEndpoint.searchParams.set('project_id', projectId)
    await rpc(fetchImpl, fullEndpoint, scopedToken, 5, 'initialize', {}, 401)
    checks.push('full_endpoint_denied')

    const mutation = await rpc(fetchImpl, endpoint, scopedToken, 6, 'tools/call', {
      name: 'repository_create_branch', arguments: { project_id: projectId, name: 'agent/forbidden-smoke' },
    })
    if (mutation.body?.result?.structuredContent?.error?.code !== 'TOOL_DISABLED_FOR_PROFILE') throw new Error('Mutation did not fail closed')
    checks.push('mutation_denied')
  } finally {
    if (credentialId) {
      await requestJson(fetchImpl, new URL(`/api/subscription/credentials/${credentialId}/revoke`, base), {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
      }, 200)
      checks.push('credential_revoked')
    }
  }

  if (scopedToken) {
    const endpoint = new URL('/mcp/subscription', base)
    endpoint.searchParams.set('project_id', projectId)
    await rpc(fetchImpl, endpoint, scopedToken, 7, 'initialize', {}, 401)
    checks.push('revoked_denied')
  }

  const evidence = sanitize({
    schema_version: 'bestcode-scoped-subscription-auth-smoke-v1',
    checked_at: checkedAt,
    endpoint: new URL('/mcp/subscription', base).toString(),
    project_id: projectId,
    credential_id: credentialId,
    checks,
    raw_credential_persisted: false,
    production_mutation: 'credential-created-then-revoked-only',
    status: 'passed',
  })
  assertNoScopedSecret(evidence)
  return evidence
}

function args(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    result[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return result
}

async function main() {
  const options = args(process.argv.slice(2))
  const output = resolve(options.output ?? 'artifacts/scoped-subscription-auth-smoke.json')
  const evidence = await runScopedSubscriptionAuthSmoke({
    backendUrl: options['backend-url'] ?? process.env.BESTCODE_BACKEND_URL,
    ownerToken: process.env.BESTCODE_AUTH_TOKEN ?? process.env.AUTH_TOKEN,
    projectId: options['project-id'] ?? 'bestcode',
  })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks, output }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(text(error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  })
}
