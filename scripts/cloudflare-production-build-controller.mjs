#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assessActiveDeployment, assessTriggerPolicy } from './cloudflare-release-integrity.mjs'

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

function text(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeSha(value) {
  const sha = text(value, 64).toLowerCase()
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null
}

function normalizePath(value) {
  return text(value, 240).replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function normalizeWorkers(value) {
  const workers = JSON.parse(value || '[]')
  if (!Array.isArray(workers) || workers.length === 0) throw new Error('BESTCODE_PRODUCTION_WORKERS is required')
  return workers.map((worker) => {
    const name = text(worker?.name, 160)
    const rootDirectory = normalizePath(worker?.root_directory)
    if (!name || !rootDirectory) throw new Error('Each production worker requires name and root_directory')
    return { name, root_directory: rootDirectory }
  })
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function errorMessage(body) {
  return Array.isArray(body?.errors)
    ? body.errors.map((item) => text(item?.message, 300)).filter(Boolean).join('; ')
    : ''
}

async function cloudflareRequest(path, options, request = {}) {
  const response = await options.fetchImpl(`${CLOUDFLARE_API_BASE}${path}`, {
    method: request.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  })
  const raw = await response.text()
  let body
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    throw new Error(`Cloudflare API ${response.status}: invalid JSON response`)
  }
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare API ${response.status}: ${errorMessage(body) || 'request failed'}`)
  }
  return body.result
}

function findBuildForVersion(result, versionId) {
  const builds = result && typeof result === 'object' && result.builds && typeof result.builds === 'object'
    ? result.builds
    : {}
  if (builds[versionId] && typeof builds[versionId] === 'object') return builds[versionId]
  return Object.values(builds).find((item) => item && typeof item === 'object') ?? null
}

async function loadWorkerIndex(options) {
  const result = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts`,
    options,
  )
  const workers = Array.isArray(result) ? result : []
  return new Map(workers.map((worker) => [
    text(worker?.id ?? worker?.name, 160),
    { name: text(worker?.id ?? worker?.name, 160), tag: text(worker?.tag, 80) },
  ]))
}

async function loadTriggers(workerTag, options) {
  return cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/workers/${encodeURIComponent(workerTag)}/triggers`,
    options,
  )
}

async function loadActiveRelease(workerName, options) {
  const deploymentResult = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
    options,
  )
  const deployments = Array.isArray(deploymentResult?.deployments) ? deploymentResult.deployments : []
  const versionId = text(deployments[0]?.versions?.[0]?.version_id, 80)
  if (!versionId) return { deployments, build: null }
  const buildsResult = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/builds?version_ids=${encodeURIComponent(versionId)}`,
    options,
  )
  return { deployments, build: findBuildForVersion(buildsResult, versionId) }
}

export function selectProductionTrigger(rawTriggers, expected) {
  const policy = assessTriggerPolicy(rawTriggers, expected)
  if (!policy.ok || !policy.production_trigger?.trigger_uuid) {
    const detail = policy.violations.map((item) => item.code).join(', ') || 'missing production trigger'
    throw new Error(`${expected.name}: production trigger policy invalid (${detail})`)
  }
  return policy.production_trigger
}

async function createManualBuild(triggerUuid, options) {
  const result = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/triggers/${encodeURIComponent(triggerUuid)}/builds`,
    options,
    {
      method: 'POST',
      body: { branch: options.branch, commit_hash: options.sha },
    },
  )
  const buildUuid = text(result?.build_uuid, 80)
  if (!buildUuid) throw new Error('Cloudflare did not return build_uuid for manual build')
  return {
    build_uuid: buildUuid,
    already_exists: result?.already_exists === true,
    status: text(result?.status, 40) || null,
    created_on: text(result?.created_on, 80) || null,
  }
}

async function waitForBuild(buildUuid, options) {
  const deadline = Date.now() + options.waitSeconds * 1000
  let attempts = 0
  do {
    attempts += 1
    const build = await cloudflareRequest(
      `/accounts/${encodeURIComponent(options.accountId)}/builds/builds/${encodeURIComponent(buildUuid)}`,
      options,
    )
    const outcome = text(build?.build_outcome, 40)
    const status = text(build?.status, 40)
    if (outcome === 'success') return { attempts, outcome, status: status || 'stopped' }
    if (['fail', 'cancelled', 'terminated', 'skipped'].includes(outcome)) {
      throw new Error(`Cloudflare build ${buildUuid} finished with outcome ${outcome}`)
    }
    if (Date.now() >= deadline) throw new Error(`Cloudflare build ${buildUuid} did not finish within ${options.waitSeconds} seconds`)
    await (options.sleepImpl ?? delay)(options.pollSeconds * 1000)
  } while (true)
}

async function waitForExpectedActive(worker, expected, options) {
  const deadline = Date.now() + options.waitSeconds * 1000
  let attempts = 0
  let latest
  do {
    attempts += 1
    const active = await loadActiveRelease(worker.name, options)
    latest = assessActiveDeployment(active.deployments, active.build, expected)
    if (latest.ok) return { attempts, state: latest.state, version_id: latest.active_deployment?.versions?.[0]?.version_id ?? null }
    if (!latest.retryable && latest.state !== 'unverified') {
      const detail = latest.violations.map((item) => item.code).join(', ')
      throw new Error(`${worker.name}: active production failed closed (${detail})`)
    }
    if (Date.now() >= deadline) {
      const detail = latest?.violations?.map((item) => item.code).join(', ') || 'unknown'
      throw new Error(`${worker.name}: expected main SHA did not become active (${detail})`)
    }
    await (options.sleepImpl ?? delay)(options.pollSeconds * 1000)
  } while (true)
}

export async function deliverProductionBuilds(options) {
  const startedAt = new Date().toISOString()
  const workerIndex = await loadWorkerIndex(options)
  const deliveries = []

  for (const worker of options.workers) {
    const indexed = workerIndex.get(worker.name)
    if (!indexed?.tag) throw new Error(`${worker.name}: Cloudflare Worker tag not found`)
    const expected = {
      ...worker,
      repository: options.repository,
      branch: options.branch,
      sha: options.sha,
    }
    const triggers = await loadTriggers(indexed.tag, options)
    const trigger = selectProductionTrigger(triggers, expected)
    const active = await loadActiveRelease(worker.name, options)
    const activeAssessment = assessActiveDeployment(active.deployments, active.build, expected)

    if (activeAssessment.ok) {
      deliveries.push({
        worker: worker.name,
        trigger_uuid: trigger.trigger_uuid,
        action: 'already_active',
        build: null,
        build_result: null,
        activation: { attempts: 1, state: activeAssessment.state },
      })
      continue
    }

    const build = await createManualBuild(trigger.trigger_uuid, options)
    const buildResult = await waitForBuild(build.build_uuid, options)
    const activation = await waitForExpectedActive(worker, expected, options)
    deliveries.push({
      worker: worker.name,
      trigger_uuid: trigger.trigger_uuid,
      action: build.already_exists ? 'joined_existing_build' : 'manual_build_created',
      build,
      build_result: buildResult,
      activation,
    })
  }

  return {
    evidence_id: `ev_production_delivery_${text(options.runId, 80) || Date.now()}`,
    schema_version: 1,
    type: 'production_delivery',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/cloudflare-production-build-controller.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: options.repository,
      branch: options.branch,
      commit_sha: options.sha,
      workers: options.workers.map((worker) => worker.name),
    },
    execution: {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      conclusion: 'success',
    },
    security: { redaction_applied: true, sensitivity: 'internal' },
    deliveries,
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

async function writeEvidence(path, evidence) {
  const destination = resolve(path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  return destination
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const options = {
    accountId: text(process.env.CLOUDFLARE_ACCOUNT_ID, 64),
    token: text(process.env.CLOUDFLARE_API_TOKEN, 4096),
    repository: text(args.repository ?? process.env.GITHUB_REPOSITORY, 240),
    branch: text(args.branch ?? 'main', 160),
    sha: normalizeSha(args['expected-sha'] ?? process.env.GITHUB_SHA),
    workers: normalizeWorkers(process.env.BESTCODE_PRODUCTION_WORKERS),
    waitSeconds: Number.parseInt(args['wait-seconds'] ?? '900', 10),
    pollSeconds: Number.parseInt(args['poll-seconds'] ?? '10', 10),
    runId: process.env.GITHUB_RUN_ID,
    fetchImpl: globalThis.fetch,
  }

  let evidence
  try {
    if (!options.accountId || !options.token || !options.repository || !options.branch || !options.sha) {
      throw new Error('Required Cloudflare credentials or exact main SHA are missing')
    }
    if (!Number.isInteger(options.waitSeconds) || options.waitSeconds < 30 || options.waitSeconds > 1800) {
      throw new Error('--wait-seconds must be between 30 and 1800')
    }
    if (!Number.isInteger(options.pollSeconds) || options.pollSeconds < 5 || options.pollSeconds > 60) {
      throw new Error('--poll-seconds must be between 5 and 60')
    }
    evidence = await deliverProductionBuilds(options)
  } catch (error) {
    evidence = {
      evidence_id: `ev_production_delivery_${text(options.runId, 80) || Date.now()}`,
      schema_version: 1,
      type: 'production_delivery',
      project_id: 'bestcode',
      scope: {
        repository: options.repository || null,
        branch: options.branch || null,
        commit_sha: options.sha || null,
        workers: options.workers?.map((worker) => worker.name) ?? [],
      },
      execution: {
        completed_at: new Date().toISOString(),
        conclusion: 'failure',
        error: text(error?.message ?? error, 500),
      },
      security: { redaction_applied: true, sensitivity: 'internal' },
      deliveries: [],
    }
  }

  const destination = await writeEvidence(args.output ?? 'artifacts/production-delivery.json', evidence)
  console.log(`BestCode production delivery: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${destination}`)
  if (evidence.execution.conclusion !== 'success') process.exitCode = 1
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(resolve(process.argv[1])).href

if (isEntryPoint) await runCli()
