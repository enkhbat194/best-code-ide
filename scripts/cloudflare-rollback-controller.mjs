#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { classifyDeployCommand } from './cloudflare-release-integrity.mjs'

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'
const GITHUB_API_BASE = 'https://api.github.com'

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizePath(value) {
  return text(value, 240).replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function normalizeSha(value) {
  const sha = text(value, 64).toLowerCase()
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null
}

function normalizeUuid(value) {
  const id = text(value, 80).toLowerCase()
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    ? id
    : null
}

function repoMatches(actual, expected) {
  const actualRepo = text(actual, 240).toLowerCase().replace(/\.git$/, '')
  const expectedRepo = text(expected, 240).toLowerCase().replace(/\.git$/, '')
  return Boolean(actualRepo && expectedRepo)
    && (actualRepo === expectedRepo || actualRepo === expectedRepo.split('/').at(-1))
}

function sanitizeBuild(value) {
  const build = isObject(value) ? value : {}
  const metadata = isObject(build.build_trigger_metadata) ? build.build_trigger_metadata : {}
  const trigger = isObject(build.trigger) ? build.trigger : {}
  const repo = isObject(metadata.repo_connection)
    ? metadata.repo_connection
    : isObject(trigger.repo_connection) ? trigger.repo_connection : {}
  return {
    build_uuid: text(build.build_uuid, 80) || null,
    outcome: text(build.build_outcome, 40) || null,
    branch: text(metadata.branch, 160).replace(/^refs\/heads\//, '') || null,
    commit_sha: normalizeSha(metadata.commit_hash),
    deploy_command: text(metadata.deploy_command ?? trigger.deploy_command, 500) || null,
    deploy_mode: classifyDeployCommand(metadata.deploy_command ?? trigger.deploy_command),
    root_directory: normalizePath(metadata.root_directory ?? trigger.root_directory),
    repository: {
      provider_type: text(repo.provider_type, 40) || null,
      repo_name: text(repo.repo_name, 240) || null,
    },
  }
}

function sanitizeDeployment(value) {
  const deployment = isObject(value) ? value : {}
  return {
    id: normalizeUuid(deployment.id),
    created_on: text(deployment.created_on, 80) || null,
    source: text(deployment.source, 80) || null,
    versions: (Array.isArray(deployment.versions) ? deployment.versions : []).map((version) => ({
      version_id: normalizeUuid(version?.version_id),
      percentage: Number(version?.percentage),
    })),
  }
}

function versionIsSafe(versionId, build, expected) {
  return Boolean(
    versionId
    && build
    && build.outcome === 'success'
    && build.branch === 'main'
    && build.commit_sha
    && build.deploy_mode === 'production_deploy'
    && (!build.root_directory || build.root_directory === normalizePath(expected.root_directory))
    && (!build.repository.repo_name || repoMatches(build.repository.repo_name, expected.repository)),
  )
}

function versionRecord(deployment, version, build) {
  return {
    deployment_id: deployment.id,
    deployed_at: deployment.created_on,
    version_id: version.version_id,
    traffic_percentage: version.percentage,
    commit_sha: build.commit_sha,
    build_uuid: build.build_uuid,
    branch: build.branch,
    root_directory: build.root_directory,
  }
}

export function validateCurrentDeployment(rawDeployments, rawBuildsByVersion, expected) {
  const deployments = (Array.isArray(rawDeployments) ? rawDeployments : []).map(sanitizeDeployment)
  const active = deployments[0]
  if (!active?.id || active.versions.length !== 1 || active.versions[0]?.percentage !== 100) {
    throw new Error('Current production must be one active version at 100% traffic')
  }
  const version = active.versions[0]
  const build = sanitizeBuild(rawBuildsByVersion?.[version.version_id])
  if (!versionIsSafe(version.version_id, build, expected)) {
    throw new Error('Current active version is not a verified main production build')
  }
  if (build.commit_sha !== expected.main_sha) {
    throw new Error('Current active version does not match the expected main SHA')
  }
  return versionRecord(active, version, build)
}

export function selectRollbackCandidate(rawDeployments, rawBuildsByVersion, expected, ancestorShas) {
  const deployments = (Array.isArray(rawDeployments) ? rawDeployments : []).map(sanitizeDeployment)
  const activeVersionId = deployments[0]?.versions?.[0]?.version_id
  for (const deployment of deployments.slice(1)) {
    if (!deployment.id || deployment.versions.length !== 1 || deployment.versions[0]?.percentage !== 100) continue
    const version = deployment.versions[0]
    if (!version.version_id || version.version_id === activeVersionId) continue
    const build = sanitizeBuild(rawBuildsByVersion?.[version.version_id])
    if (!versionIsSafe(version.version_id, build, expected)) continue
    if (!ancestorShas.has(build.commit_sha)) continue
    return versionRecord(deployment, version, build)
  }
  return null
}

export async function rehearseRollback({ current, candidate, deploy, poll, smoke, getActive = async () => candidate.version_id }) {
  const events = []
  let rollbackCreated = false
  let primaryError = null
  let restoreError = null
  let restored = false

  try {
    const rollbackDeployment = await deploy(candidate.version_id, `BestCode rollback rehearsal to ${candidate.commit_sha.slice(0, 8)}`)
    rollbackCreated = true
    events.push({ action: 'rollback_deployment_created', deployment_id: rollbackDeployment.id, version_id: candidate.version_id })
    await poll(candidate.version_id)
    events.push({ action: 'rollback_became_active', version_id: candidate.version_id })
    events.push({ action: 'rollback_smoke', ...(await smoke('rollback')) })
  } catch (error) {
    primaryError = text(error?.message ?? error, 500)
  } finally {
    if (rollbackCreated) {
      try {
        const activeVersionId = await getActive()
        events.push({ action: 'pre_restore_active_check', version_id: activeVersionId })
        if (activeVersionId === current.version_id) {
          restored = true
          events.push({ action: 'restore_already_active', version_id: current.version_id })
        } else if (activeVersionId !== candidate.version_id) {
          throw new Error(`Restore blocked because active version changed concurrently to ${activeVersionId ?? 'unknown'}`)
        } else {
          const restoreDeployment = await deploy(current.version_id, `BestCode rollback rehearsal restore ${current.commit_sha.slice(0, 8)}`)
          events.push({ action: 'restore_deployment_created', deployment_id: restoreDeployment.id, version_id: current.version_id })
          await poll(current.version_id)
          events.push({ action: 'restore_became_active', version_id: current.version_id })
          events.push({ action: 'restore_smoke', ...(await smoke('restore')) })
          restored = true
        }
      } catch (error) {
        restoreError = text(error?.message ?? error, 500)
      }
    }
  }

  return {
    ok: rollbackCreated && !primaryError && !restoreError,
    primary_error: primaryError,
    restore_error: restoreError,
    restored,
    events,
  }
}

function apiFailureMessage(data) {
  if (!Array.isArray(data?.errors)) return ''
  return data.errors
    .map((item) => {
      const code = Number.isFinite(Number(item?.code)) ? `code ${Number(item.code)}` : ''
      const message = text(item?.message, 240)
      return [code, message].filter(Boolean).join(': ')
    })
    .filter(Boolean)
    .join('; ')
    .slice(0, 500)
}

export async function apiRequest(url, { token, fetchImpl, method = 'GET', body }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const raw = await response.text()
  let data
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    throw new Error(`API ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const detail = apiFailureMessage(data)
    throw new Error(`API ${response.status}: ${detail || 'request failed'}`)
  }
  return data
}

async function cloudflare(path, options, request = {}) {
  const data = await apiRequest(`${CLOUDFLARE_API_BASE}${path}`, {
    token: options.cloudflareToken,
    fetchImpl: options.fetchImpl,
    ...request,
  })
  if (data?.success !== true) {
    const message = Array.isArray(data?.errors)
      ? data.errors.map((item) => text(item?.message, 240)).filter(Boolean).join('; ')
      : 'request failed'
    throw new Error(`Cloudflare API: ${message}`)
  }
  return data.result
}

async function github(path, options) {
  return apiRequest(`${GITHUB_API_BASE}${path}`, {
    token: options.githubToken,
    fetchImpl: options.fetchImpl,
  })
}

function buildMap(result) {
  return isObject(result?.builds) ? result.builds : {}
}

async function loadReleaseHistory(worker, options) {
  const result = await cloudflare(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(worker.name)}/deployments`,
    options,
  )
  const deployments = Array.isArray(result?.deployments) ? result.deployments : []
  const versionIds = [...new Set(deployments.flatMap((deployment) =>
    (Array.isArray(deployment?.versions) ? deployment.versions : [])
      .map((version) => normalizeUuid(version?.version_id))
      .filter(Boolean),
  ))].slice(0, 20)
  if (versionIds.length === 0) return { deployments, builds: {} }
  const builds = await cloudflare(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/builds?version_ids=${encodeURIComponent(versionIds.join(','))}`,
    options,
  )
  return { deployments, builds: buildMap(builds) }
}

async function isAncestor(candidateSha, expectedMainSha, options) {
  const result = await github(
    `/repos/${options.repository.split('/').map(encodeURIComponent).join('/')}/compare/${candidateSha}...${expectedMainSha}`,
    options,
  )
  return ['ahead', 'identical'].includes(result?.status)
    && normalizeSha(result?.merge_base_commit?.sha) === candidateSha
}

export async function createDeployment(worker, versionId, message, options) {
  const result = await cloudflare(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(worker.name)}/deployments?force=true`,
    options,
    {
      method: 'POST',
      body: {
        strategy: 'percentage',
        versions: [{ percentage: 100, version_id: versionId }],
        annotations: {
          'workers/message': message,
        },
      },
    },
  )
  const id = normalizeUuid(result?.id)
  if (!id) throw new Error('Cloudflare did not return a valid deployment ID')
  return { id }
}

async function waitForActive(worker, versionId, options) {
  const deadline = Date.now() + 60_000
  do {
    const result = await cloudflare(
      `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(worker.name)}/deployments`,
      options,
    )
    const active = sanitizeDeployment(result?.deployments?.[0])
    if (active.versions.length === 1
      && active.versions[0]?.version_id === versionId
      && active.versions[0]?.percentage === 100) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000))
  } while (Date.now() < deadline)
  throw new Error(`Version ${versionId} did not become active at 100% within 60 seconds`)
}

async function loadActiveVersionId(worker, options) {
  const result = await cloudflare(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(worker.name)}/deployments`,
    options,
  )
  const active = sanitizeDeployment(result?.deployments?.[0])
  if (active.versions.length !== 1 || active.versions[0]?.percentage !== 100) return null
  return active.versions[0]?.version_id ?? null
}

async function smoke(worker, stage, options) {
  const response = await options.fetchImpl(worker.smoke_url, {
    headers: { Accept: worker.smoke_kind === 'json_health' ? 'application/json' : 'text/html' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`${stage} smoke returned HTTP ${response.status}`)
  if (worker.smoke_kind === 'json_health') {
    const body = await response.json()
    if (body?.ok !== true) throw new Error(`${stage} health response was not ok`)
  } else {
    const body = await response.text()
    if (!/<html[\s>]/i.test(body)) throw new Error(`${stage} frontend smoke did not return HTML`)
  }
  return { stage, ok: true, status: response.status, url: worker.smoke_url }
}

async function resolvePlan(worker, options) {
  const expected = {
    repository: options.repository,
    root_directory: worker.root_directory,
    main_sha: options.expectedMainSha,
  }
  const deadline = Date.now() + options.waitSeconds * 1000
  let history
  let current
  let attempts = 0
  do {
    attempts += 1
    history = await loadReleaseHistory(worker, options)
    try {
      current = validateCurrentDeployment(history.deployments, history.builds, expected)
      break
    } catch (error) {
      const isExpectedMainLag = /does not match the expected main SHA/.test(String(error?.message ?? error))
      if (!isExpectedMainLag || Date.now() >= deadline) throw error
      await (options.sleepImpl ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))))(
        options.pollSeconds * 1000,
      )
    }
  } while (true)

  const ancestorShas = new Set()
  for (const build of Object.values(history.builds)) {
    const sha = sanitizeBuild(build).commit_sha
    if (sha && sha !== options.expectedMainSha && await isAncestor(sha, options.expectedMainSha, options)) {
      ancestorShas.add(sha)
    }
  }
  const candidate = selectRollbackCandidate(history.deployments, history.builds, expected, ancestorShas)
  if (!candidate) throw new Error(`No previous-good main rollback candidate found for ${worker.name}`)
  return { current, candidate, attempts }
}

function baseEvidence(worker, options) {
  return {
    evidence_id: `ev_rollback_${text(options.runId, 80) || Date.now()}_${worker.name}`,
    schema_version: 1,
    type: 'rollback',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/cloudflare-rollback-controller.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: options.repository,
      branch: 'main',
      commit_sha: options.expectedMainSha,
      worker: worker.name,
    },
    security: { redaction_applied: true, sensitivity: 'internal' },
  }
}

async function runController(worker, options) {
  const evidence = baseEvidence(worker, options)
  try {
    const plan = await resolvePlan(worker, options)
    evidence.plan = plan
    if (options.mode === 'plan') {
      evidence.execution = { checked_at: new Date().toISOString(), conclusion: 'success', mode: 'plan' }
      return evidence
    }
    if (options.confirmation !== 'REHEARSE_ROLLBACK') throw new Error('Exact confirmation REHEARSE_ROLLBACK is required')
    if (plan.candidate.version_id !== options.targetVersionId || plan.candidate.commit_sha !== options.targetCommitSha) {
      throw new Error('Requested rollback target does not match the current previous-good plan')
    }
    const rehearsal = await rehearseRollback({
      current: plan.current,
      candidate: plan.candidate,
      deploy: (versionId, message) => createDeployment(worker, versionId, message, options),
      poll: (versionId) => waitForActive(worker, versionId, options),
      smoke: (stage) => smoke(worker, stage, options),
      getActive: () => loadActiveVersionId(worker, options),
    })
    evidence.rehearsal = rehearsal
    evidence.execution = {
      checked_at: new Date().toISOString(),
      conclusion: rehearsal.ok ? 'success' : 'failure',
      mode: 'rehearse',
    }
    return evidence
  } catch (error) {
    evidence.execution = {
      checked_at: new Date().toISOString(),
      conclusion: 'blocked',
      mode: options.mode,
      error: text(error?.message ?? error, 500),
    }
    return evidence
  }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`Invalid argument near ${key ?? 'end'}`)
    args[key.slice(2)] = value
  }
  return args
}

function parseWorkers(value) {
  const workers = JSON.parse(value || '[]')
  if (!Array.isArray(workers) || workers.length === 0) throw new Error('BESTCODE_ROLLBACK_WORKERS is required')
  return workers.map((worker) => {
    const parsed = {
      name: text(worker?.name, 160),
      root_directory: normalizePath(worker?.root_directory),
      smoke_url: text(worker?.smoke_url, 500),
      smoke_kind: text(worker?.smoke_kind, 40),
    }
    if (!parsed.name || !parsed.root_directory || !/^https:\/\//.test(parsed.smoke_url)) {
      throw new Error('Each rollback worker requires name, root_directory, and HTTPS smoke_url')
    }
    if (!['json_health', 'html'].includes(parsed.smoke_kind)) {
      throw new Error(`Unsupported smoke_kind for ${parsed.name}`)
    }
    return parsed
  })
}

async function writeEvidence(path, evidence) {
  const destination = resolve(path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  return destination
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const workers = parseWorkers(process.env.BESTCODE_ROLLBACK_WORKERS)
  const worker = workers.find((item) => item.name === args.worker)
  const options = {
    mode: args.mode ?? 'plan',
    accountId: text(process.env.CLOUDFLARE_ACCOUNT_ID, 64),
    cloudflareToken: text(process.env.CLOUDFLARE_API_TOKEN, 4096),
    githubToken: text(process.env.GITHUB_TOKEN, 4096),
    repository: text(args.repository ?? process.env.GITHUB_REPOSITORY, 240),
    expectedMainSha: normalizeSha(args['expected-main-sha'] ?? process.env.GITHUB_SHA),
    targetVersionId: args['target-version-id'] ? normalizeUuid(args['target-version-id']) : null,
    targetCommitSha: args['target-commit-sha'] ? normalizeSha(args['target-commit-sha']) : null,
    confirmation: args.confirmation ?? '',
    waitSeconds: Number.parseInt(args['wait-seconds'] ?? '0', 10),
    pollSeconds: Number.parseInt(args['poll-seconds'] ?? '20', 10),
    runId: process.env.GITHUB_RUN_ID,
    fetchImpl: globalThis.fetch,
  }
  let evidence
  if (!worker) {
    evidence = { execution: { conclusion: 'blocked', error: `Unknown worker ${args.worker ?? ''}` } }
  } else if (!['plan', 'rehearse'].includes(options.mode)) {
    evidence = { ...baseEvidence(worker, options), execution: { conclusion: 'blocked', error: 'Mode must be plan or rehearse' } }
  } else if (!options.accountId || !options.cloudflareToken || !options.githubToken || !options.repository || !options.expectedMainSha) {
    evidence = { ...baseEvidence(worker, options), execution: { conclusion: 'blocked', error: 'Required CI credentials or expected main SHA are missing' } }
  } else if (!Number.isInteger(options.waitSeconds) || options.waitSeconds < 0 || options.waitSeconds > 1800) {
    evidence = { ...baseEvidence(worker, options), execution: { conclusion: 'blocked', error: '--wait-seconds must be between 0 and 1800' } }
  } else if (!Number.isInteger(options.pollSeconds) || options.pollSeconds < 5 || options.pollSeconds > 60) {
    evidence = { ...baseEvidence(worker, options), execution: { conclusion: 'blocked', error: '--poll-seconds must be between 5 and 60' } }
  } else {
    evidence = await runController(worker, options)
  }
  const destination = await writeEvidence(args.output ?? `artifacts/rollback-${args.worker ?? 'unknown'}.json`, evidence)
  console.log(`BestCode rollback ${options.mode}: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${destination}`)
  if (evidence.plan?.candidate) {
    console.log(`Candidate: ${evidence.plan.candidate.version_id} · ${evidence.plan.candidate.commit_sha}`)
  }
  if (evidence.execution.conclusion !== 'success') process.exitCode = 1
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(resolve(process.argv[1])).href

if (isEntryPoint) await runCli()
