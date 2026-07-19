#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'
const DEFAULT_WORKERS = [
  { name: 'best-code-ide', root_directory: 'backend' },
  { name: 'best-code-ide-appl', root_directory: 'frontend' },
]

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizePath(value) {
  return boundedText(value, 240).replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => boundedText(item, 160)).filter(Boolean))].sort()
    : []
}

function sameStrings(left, right) {
  const a = normalizeStringArray(left)
  const b = normalizeStringArray(right)
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function normalizeSha(value) {
  const sha = boundedText(value, 64).toLowerCase()
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null
}

function repoMatches(actual, expected) {
  const actualRepo = boundedText(actual, 240).toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const expectedRepo = boundedText(expected, 240).toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (!actualRepo || !expectedRepo) return false
  return actualRepo === expectedRepo || actualRepo === expectedRepo.split('/').at(-1)
}

export function classifyDeployCommand(value) {
  const command = boundedText(value, 500).replace(/\s+/g, ' ')
  if (/\bwrangler(?:@[^\s]+)?\s+versions\s+upload\b/i.test(command)) return 'preview_upload'
  if (/\bwrangler(?:@[^\s]+)?\s+deploy\b/i.test(command)) return 'production_deploy'
  return 'unknown'
}

function sanitizeRepoConnection(value) {
  const repo = isObject(value) ? value : {}
  return {
    provider_type: boundedText(repo.provider_type, 40) || null,
    repo_name: boundedText(repo.repo_name, 240) || null,
  }
}

export function sanitizeTrigger(value) {
  const trigger = isObject(value) ? value : {}
  return {
    trigger_uuid: boundedText(trigger.trigger_uuid, 80) || null,
    trigger_name: boundedText(trigger.trigger_name, 160) || null,
    branch_includes: normalizeStringArray(trigger.branch_includes),
    branch_excludes: normalizeStringArray(trigger.branch_excludes),
    build_command: boundedText(trigger.build_command, 500) || null,
    deploy_command: boundedText(trigger.deploy_command, 500) || null,
    deploy_mode: classifyDeployCommand(trigger.deploy_command),
    root_directory: normalizePath(trigger.root_directory),
    repository: sanitizeRepoConnection(trigger.repo_connection),
    created_on: boundedText(trigger.created_on, 80) || null,
    modified_on: boundedText(trigger.modified_on, 80) || null,
  }
}

function violation(code, message) {
  return { code, message }
}

function validateTriggerTarget(trigger, expected) {
  const violations = []
  if (normalizePath(trigger.root_directory) !== normalizePath(expected.root_directory)) {
    violations.push(violation(
      'BC-R23-ROOT-MISMATCH',
      `${expected.name}: trigger root “${trigger.root_directory || '/'}” нь expected “${expected.root_directory}”-тэй таарахгүй.`,
    ))
  }
  if (trigger.repository.provider_type !== 'github') {
    violations.push(violation(
      'BC-R23-PROVIDER-MISMATCH',
      `${expected.name}: trigger provider GitHub биш байна.`,
    ))
  }
  if (!repoMatches(trigger.repository.repo_name, expected.repository)) {
    violations.push(violation(
      'BC-R23-REPOSITORY-MISMATCH',
      `${expected.name}: trigger repository expected ${expected.repository}-тэй таарахгүй.`,
    ))
  }
  return violations
}

export function assessTriggerPolicy(rawTriggers, expected) {
  const triggers = (Array.isArray(rawTriggers) ? rawTriggers : [])
    .filter((item) => !boundedText(item?.deleted_on, 80))
    .map(sanitizeTrigger)
  const violations = []
  const production = []
  const previews = []

  for (const trigger of triggers) {
    const exactProductionBranch = sameStrings(trigger.branch_includes, [expected.branch])
      && sameStrings(trigger.branch_excludes, [])
    const exactPreviewBranches = sameStrings(trigger.branch_includes, ['*'])
      && sameStrings(trigger.branch_excludes, [expected.branch])

    if (exactProductionBranch) {
      production.push(trigger)
      if (trigger.deploy_mode !== 'production_deploy') {
        violations.push(violation(
          'BC-R23-PRODUCTION-COMMAND',
          `${expected.name}: ${expected.branch} trigger нь explicit “wrangler deploy” биш байна.`,
        ))
      }
      violations.push(...validateTriggerTarget(trigger, expected))
      continue
    }

    if (exactPreviewBranches) {
      previews.push(trigger)
      if (trigger.deploy_mode !== 'preview_upload') {
        violations.push(violation(
          'BC-R23-PREVIEW-COMMAND',
          `${expected.name}: non-main trigger production deploy хийж болзошгүй; “wrangler versions upload” шаардлагатай.`,
        ))
      }
      violations.push(...validateTriggerTarget(trigger, expected))
      continue
    }

    violations.push(violation(
      'BC-R23-UNSAFE-BRANCH-FILTER',
      `${expected.name}: trigger branch filter production эсвэл preview-only contract-д таарахгүй.`,
    ))
  }

  if (production.length !== 1) {
    violations.push(violation(
      'BC-R23-PRODUCTION-TRIGGER-COUNT',
      `${expected.name}: яг нэг main production trigger шаардлагатай; олдсон ${production.length}.`,
    ))
  }
  if (previews.length > 1) {
    violations.push(violation(
      'BC-R23-PREVIEW-TRIGGER-COUNT',
      `${expected.name}: preview trigger хамгийн ихдээ нэг байна; олдсон ${previews.length}.`,
    ))
  }

  return {
    ok: violations.length === 0,
    preview_policy: previews.length === 1 ? 'versions_upload_only' : 'disabled',
    violations,
    production_trigger: production[0] ?? null,
    preview_trigger: previews[0] ?? null,
    observed_trigger_count: triggers.length,
  }
}

export function planPreviewTriggerRepairs(rawTriggers, expected) {
  const repairs = []
  for (const rawTrigger of Array.isArray(rawTriggers) ? rawTriggers : []) {
    if (boundedText(rawTrigger?.deleted_on, 80)) continue
    const trigger = sanitizeTrigger(rawTrigger)
    const exactPreviewBranches = sameStrings(trigger.branch_includes, ['*'])
      && sameStrings(trigger.branch_excludes, [expected.branch])
    const targetIsExact = validateTriggerTarget(trigger, expected).length === 0
    if (
      exactPreviewBranches
      && targetIsExact
      && trigger.deploy_mode === 'production_deploy'
      && trigger.trigger_uuid
    ) {
      repairs.push({
        trigger_uuid: trigger.trigger_uuid,
        trigger_name: trigger.trigger_name,
        before: trigger.deploy_command,
        after: 'npx wrangler versions upload',
      })
    }
  }
  return repairs
}

function sanitizeDeployment(value) {
  const deployment = isObject(value) ? value : {}
  const versions = Array.isArray(deployment.versions) ? deployment.versions : []
  return {
    id: boundedText(deployment.id, 80) || null,
    created_on: boundedText(deployment.created_on, 80) || null,
    source: boundedText(deployment.source, 80) || null,
    strategy: boundedText(deployment.strategy, 80) || null,
    versions: versions.map((item) => ({
      version_id: boundedText(item?.version_id, 80) || null,
      percentage: Number(item?.percentage),
    })),
  }
}

function sanitizeBuild(value) {
  const build = isObject(value) ? value : {}
  const metadata = isObject(build.build_trigger_metadata) ? build.build_trigger_metadata : {}
  const trigger = isObject(build.trigger) ? build.trigger : {}
  const repoConnection = isObject(trigger.repo_connection) ? trigger.repo_connection : {}
  return {
    build_uuid: boundedText(build.build_uuid, 80) || null,
    outcome: boundedText(build.build_outcome, 40) || null,
    branch: boundedText(metadata.branch, 160).replace(/^refs\/heads\//, '') || null,
    commit_sha: normalizeSha(metadata.commit_hash),
    trigger_source: boundedText(metadata.build_trigger_source, 40) || null,
    deploy_command: boundedText(metadata.deploy_command ?? trigger.deploy_command, 500) || null,
    deploy_mode: classifyDeployCommand(metadata.deploy_command ?? trigger.deploy_command),
    root_directory: normalizePath(metadata.root_directory ?? trigger.root_directory),
    repository: sanitizeRepoConnection(metadata.repo_connection ?? repoConnection),
    started_on: boundedText(build.started_on, 80) || null,
    completed_on: boundedText(build.completed_on, 80) || null,
  }
}

export function assessActiveDeployment(rawDeployments, rawBuild, expected) {
  const deployments = Array.isArray(rawDeployments) ? rawDeployments : []
  const deployment = sanitizeDeployment(deployments[0])
  const build = rawBuild ? sanitizeBuild(rawBuild) : null
  const violations = []

  if (!deployment.id) {
    return {
      ok: false,
      state: 'unverified',
      retryable: true,
      violations: [violation('BC-R23-NO-ACTIVE-DEPLOYMENT', `${expected.name}: active deployment олдсонгүй.`)],
      active_deployment: null,
      active_build: build,
    }
  }

  if (deployment.versions.length !== 1 || deployment.versions[0]?.percentage !== 100) {
    violations.push(violation(
      'BC-R23-TRAFFIC-SPLIT',
      `${expected.name}: production traffic яг нэг version-д 100% байх ёстой.`,
    ))
  }

  if (!build) {
    return {
      ok: false,
      state: 'unverified',
      retryable: true,
      violations: [...violations, violation(
        'BC-R23-BUILD-MAPPING-MISSING',
        `${expected.name}: active version-ийг Workers Build metadata-тай холбож чадсангүй.`,
      )],
      active_deployment: deployment,
      active_build: null,
    }
  }

  if (build.outcome !== 'success') {
    violations.push(violation('BC-R23-BUILD-NOT-SUCCESS', `${expected.name}: active version build success биш байна.`))
  }
  if (build.deploy_mode !== 'production_deploy') {
    violations.push(violation(
      'BC-R23-ACTIVE-DEPLOY-COMMAND',
      `${expected.name}: active version explicit production deploy-оос гараагүй.`,
    ))
  }
  if (build.branch !== expected.branch) {
    violations.push(violation(
      'BC-R23-ACTIVE-BRANCH-MISMATCH',
      `${expected.name}: active branch “${build.branch ?? 'unknown'}”; expected “${expected.branch}”.`,
    ))
  }
  if (build.commit_sha !== expected.sha) {
    violations.push(violation(
      'BC-R23-ACTIVE-SHA-MISMATCH',
      `${expected.name}: active commit expected main SHA-тай таарахгүй.`,
    ))
  }
  if (build.root_directory && build.root_directory !== normalizePath(expected.root_directory)) {
    violations.push(violation(
      'BC-R23-ACTIVE-ROOT-MISMATCH',
      `${expected.name}: active build root expected ${expected.root_directory}-тэй таарахгүй.`,
    ))
  }
  if (build.repository.repo_name && !repoMatches(build.repository.repo_name, expected.repository)) {
    violations.push(violation(
      'BC-R23-ACTIVE-REPOSITORY-MISMATCH',
      `${expected.name}: active build repository expected ${expected.repository}-тэй таарахгүй.`,
    ))
  }

  const onlyExpectedShaIsStale = violations.length === 1
    && violations[0].code === 'BC-R23-ACTIVE-SHA-MISMATCH'
    && build.branch === expected.branch

  return {
    ok: violations.length === 0,
    state: violations.length === 0 ? 'verified_main' : onlyExpectedShaIsStale ? 'stale_main' : 'source_mismatch',
    retryable: onlyExpectedShaIsStale,
    violations,
    active_deployment: deployment,
    active_build: build,
  }
}

export function assessPreviewBuild(rawBuild, expected) {
  const build = rawBuild ? sanitizeBuild(rawBuild) : null
  if (!build) {
    return {
      ok: false,
      state: 'waiting_for_preview',
      retryable: true,
      violations: [violation(
        'BC-R23-PREVIEW-BUILD-MISSING',
        `${expected.name}: ${expected.preview_branch} preview build хараахан олдсонгүй.`,
      )],
      build: null,
    }
  }

  const violations = []
  if (!build.outcome) {
    return {
      ok: false,
      state: 'waiting_for_preview',
      retryable: true,
      violations: [violation(
        'BC-R23-PREVIEW-BUILD-PENDING',
        `${expected.name}: preview build дуусаагүй байна.`,
      )],
      build,
    }
  }
  if (build.outcome !== 'success') {
    violations.push(violation(
      'BC-R23-PREVIEW-BUILD-FAILED',
      `${expected.name}: preview build outcome “${build.outcome}”.`,
    ))
  }
  if (build.branch !== expected.preview_branch) {
    violations.push(violation(
      'BC-R23-PREVIEW-BRANCH-MISMATCH',
      `${expected.name}: preview branch expected value-тэй таарахгүй.`,
    ))
  }
  if (build.commit_sha !== expected.preview_sha) {
    violations.push(violation(
      'BC-R23-PREVIEW-SHA-MISMATCH',
      `${expected.name}: preview commit expected value-тэй таарахгүй.`,
    ))
  }
  if (build.deploy_mode !== 'preview_upload') {
    violations.push(violation(
      'BC-R23-PREVIEW-DEPLOYED',
      `${expected.name}: probe branch “wrangler versions upload” ашиглаагүй.`,
    ))
  }
  if (build.root_directory && build.root_directory !== normalizePath(expected.root_directory)) {
    violations.push(violation(
      'BC-R23-PREVIEW-ROOT-MISMATCH',
      `${expected.name}: preview root expected ${expected.root_directory}-тэй таарахгүй.`,
    ))
  }
  if (build.repository.repo_name && !repoMatches(build.repository.repo_name, expected.repository)) {
    violations.push(violation(
      'BC-R23-PREVIEW-REPOSITORY-MISMATCH',
      `${expected.name}: preview repository expected ${expected.repository}-тэй таарахгүй.`,
    ))
  }

  return {
    ok: violations.length === 0,
    state: violations.length === 0 ? 'verified_preview_only' : 'preview_isolation_failed',
    retryable: false,
    violations,
    build,
  }
}

function findBuildForVersion(result, versionId) {
  const builds = isObject(result) && isObject(result.builds) ? result.builds : {}
  if (isObject(builds[versionId])) return builds[versionId]
  return Object.values(builds).find((build) => isObject(build)) ?? null
}

function findPreviewBuild(result, branch, sha) {
  const builds = Array.isArray(result) ? result : []
  return builds.find((candidate) => {
    const build = sanitizeBuild(candidate)
    return build.branch === branch && build.commit_sha === sha
  }) ?? null
}

async function cloudflareRequest(path, { accountId, token, fetchImpl }, request = {}) {
  const response = await fetchImpl(`${CLOUDFLARE_API_BASE}${path}`, {
    method: request.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Cloudflare API ${response.status}: JSON биш response буцаалаа.`)
  }
  if (!response.ok || body?.success !== true) {
    const messages = Array.isArray(body?.errors)
      ? body.errors.map((item) => boundedText(item?.message, 300)).filter(Boolean).join('; ')
      : ''
    throw new Error(`Cloudflare API ${response.status}: ${messages || 'request failed'}`)
  }
  void accountId
  return body.result
}

async function loadWorkerIndex(options) {
  const result = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts`,
    options,
  )
  const workers = Array.isArray(result) ? result : []
  return new Map(workers.map((worker) => [
    boundedText(worker?.id ?? worker?.name, 160),
    {
      name: boundedText(worker?.id ?? worker?.name, 160),
      tag: boundedText(worker?.tag, 80),
    },
  ]))
}

async function loadTriggers(workerTag, options) {
  return cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/workers/${encodeURIComponent(workerTag)}/triggers`,
    options,
  )
}

async function repairPreviewTriggers(workerIndex, options) {
  const repaired = []
  for (const worker of options.workers) {
    const indexed = workerIndex.get(worker.name)
    if (!indexed?.tag) continue
    const expected = { ...worker, branch: options.branch, repository: options.repository, sha: options.sha }
    const triggers = await loadTriggers(indexed.tag, options)
    for (const item of planPreviewTriggerRepairs(triggers, expected)) {
      const result = await cloudflareRequest(
        `/accounts/${encodeURIComponent(options.accountId)}/builds/triggers/${encodeURIComponent(item.trigger_uuid)}`,
        options,
        { method: 'PATCH', body: { deploy_command: item.after } },
      )
      const updated = sanitizeTrigger(result)
      if (updated.deploy_mode !== 'preview_upload') {
        throw new Error(`${worker.name}: preview trigger repair response did not confirm versions upload`)
      }
      repaired.push({
        worker: worker.name,
        trigger_uuid: item.trigger_uuid,
        trigger_name: item.trigger_name,
        before: item.before,
        after: updated.deploy_command,
        repaired_at: new Date().toISOString(),
      })
    }
  }
  return repaired
}

async function loadActiveRelease(workerName, options) {
  const deploymentResult = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
    options,
  )
  const deployments = Array.isArray(deploymentResult?.deployments) ? deploymentResult.deployments : []
  const versionId = boundedText(deployments[0]?.versions?.[0]?.version_id, 80)
  if (!versionId) return { deployments, build: null }
  const buildsResult = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/builds?version_ids=${encodeURIComponent(versionId)}`,
    options,
  )
  return { deployments, build: findBuildForVersion(buildsResult, versionId) }
}

async function loadPreviewBuild(workerTag, options) {
  const builds = await cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/workers/${encodeURIComponent(workerTag)}/builds`,
    options,
  )
  return findPreviewBuild(builds, options.previewBranch, options.previewSha)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export async function auditCloudflareProduction(options) {
  const checkedAt = new Date().toISOString()
  const workerIndex = await loadWorkerIndex(options)
  const repairs = options.repairPreviewTriggers
    ? await repairPreviewTriggers(workerIndex, options)
    : []
  const configured = []

  for (const worker of options.workers) {
    const indexed = workerIndex.get(worker.name)
    if (!indexed?.tag) {
      configured.push({
        name: worker.name,
        tag: null,
        trigger_policy: {
          ok: false,
          preview_policy: 'unknown',
          observed_trigger_count: 0,
          production_trigger: null,
          preview_trigger: null,
          violations: [violation('BC-R23-WORKER-NOT-FOUND', `${worker.name}: Cloudflare Worker олдсонгүй.`)],
        },
      })
      continue
    }
    const expected = { ...worker, branch: options.branch, repository: options.repository, sha: options.sha }
    const triggers = await loadTriggers(indexed.tag, options)
    configured.push({
      name: worker.name,
      tag: indexed.tag,
      trigger_policy: assessTriggerPolicy(triggers, expected),
    })
  }

  const configurationOk = configured.every((worker) => worker.trigger_policy.ok)
  const deadline = Date.now() + options.waitSeconds * 1000
  let releases = []
  let previewProbes = []
  let attempt = 0

  do {
    attempt += 1
    releases = []
    for (const worker of options.workers) {
      const expected = { ...worker, branch: options.branch, repository: options.repository, sha: options.sha }
      try {
        const active = await loadActiveRelease(worker.name, options)
        releases.push({ name: worker.name, ...assessActiveDeployment(active.deployments, active.build, expected) })
      } catch (error) {
        releases.push({
          name: worker.name,
          ok: false,
          state: 'unverified',
          retryable: true,
          violations: [violation('BC-R23-ACTIVE-QUERY-FAILED', boundedText(error?.message ?? error, 500))],
          active_deployment: null,
          active_build: null,
        })
      }
    }

    previewProbes = []
    if (options.previewBranch && options.previewSha) {
      for (const worker of options.workers) {
        const indexed = workerIndex.get(worker.name)
        const expected = {
          ...worker,
          repository: options.repository,
          preview_branch: options.previewBranch,
          preview_sha: options.previewSha,
        }
        try {
          const build = indexed?.tag ? await loadPreviewBuild(indexed.tag, options) : null
          previewProbes.push({ name: worker.name, ...assessPreviewBuild(build, expected) })
        } catch (error) {
          previewProbes.push({
            name: worker.name,
            ok: false,
            state: 'waiting_for_preview',
            retryable: true,
            violations: [violation('BC-R23-PREVIEW-QUERY-FAILED', boundedText(error?.message ?? error, 500))],
            build: null,
          })
        }
      }
    }

    const previewOk = previewProbes.every((probe) => probe.ok)
    if (configurationOk && releases.every((release) => release.ok) && previewOk) break
    const onlyRetryableLag = configurationOk
      && releases.every((release) => release.ok || release.retryable)
      && previewProbes.every((probe) => probe.ok || probe.retryable)
    if (!onlyRetryableLag || Date.now() >= deadline) break
    await (options.sleepImpl ?? sleep)(options.pollSeconds * 1000)
  } while (true)

  const ok = configurationOk
    && releases.every((release) => release.ok)
    && previewProbes.every((probe) => probe.ok)
  return {
    evidence_id: `ev_release_${boundedText(options.runId, 80) || Date.now()}`,
    schema_version: 1,
    type: 'release',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/cloudflare-release-integrity.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: options.repository,
      branch: options.branch,
      commit_sha: options.sha,
      workers: options.workers.map((worker) => worker.name),
      preview_probe: options.previewBranch && options.previewSha
        ? { branch: options.previewBranch, commit_sha: options.previewSha }
        : null,
    },
    execution: {
      checked_at: checkedAt,
      attempts: attempt,
      conclusion: ok ? 'success' : 'failure',
    },
    security: {
      redaction_applied: true,
      sensitivity: 'internal',
    },
    repairs,
    workers: configured.map((worker) => ({
      ...worker,
      release: releases.find((release) => release.name === worker.name) ?? null,
      preview_probe: previewProbes.find((probe) => probe.name === worker.name) ?? null,
    })),
  }
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

function parseWorkers(value) {
  if (!value) return DEFAULT_WORKERS
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('BESTCODE_PRODUCTION_WORKERS must be a non-empty JSON array')
  return parsed.map((worker) => {
    const name = boundedText(worker?.name, 160)
    const rootDirectory = normalizePath(worker?.root_directory)
    if (!name || !rootDirectory) throw new Error('Each production worker requires name and root_directory')
    return { name, root_directory: rootDirectory }
  })
}

function parseBoolean(value, name) {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function baseFailureEvidence(options, error) {
  return {
    evidence_id: `ev_release_${boundedText(options.runId, 80) || Date.now()}`,
    schema_version: 1,
    type: 'release',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/cloudflare-release-integrity.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: options.repository || null,
      branch: options.branch || null,
      commit_sha: options.sha || null,
      workers: options.workers?.map((worker) => worker.name) ?? [],
      preview_probe: options.previewBranch && options.previewSha
        ? { branch: options.previewBranch, commit_sha: options.previewSha }
        : null,
    },
    execution: {
      checked_at: new Date().toISOString(),
      attempts: 0,
      conclusion: 'blocked',
      error: boundedText(error?.message ?? error, 500),
    },
    security: {
      redaction_applied: true,
      sensitivity: 'internal',
    },
    repairs: [],
    workers: [],
  }
}

async function writeEvidence(output, evidence) {
  const destination = resolve(output)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  return destination
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const options = {
    accountId: boundedText(process.env.CLOUDFLARE_ACCOUNT_ID, 64),
    token: boundedText(process.env.CLOUDFLARE_API_TOKEN, 4096),
    repository: boundedText(args.repository ?? process.env.GITHUB_REPOSITORY, 240),
    branch: boundedText(args.branch ?? 'main', 160).replace(/^refs\/heads\//, ''),
    sha: normalizeSha(args['expected-sha'] ?? process.env.GITHUB_SHA),
    previewBranch: boundedText(args['expected-preview-branch'], 160).replace(/^refs\/heads\//, '') || null,
    previewSha: args['expected-preview-sha'] ? normalizeSha(args['expected-preview-sha']) : null,
    workers: parseWorkers(process.env.BESTCODE_PRODUCTION_WORKERS),
    repairPreviewTriggers: parseBoolean(args['repair-preview-triggers'], '--repair-preview-triggers'),
    waitSeconds: Number.parseInt(args['wait-seconds'] ?? '0', 10),
    pollSeconds: Number.parseInt(args['poll-seconds'] ?? '20', 10),
    runId: process.env.GITHUB_RUN_ID,
    fetchImpl: globalThis.fetch,
  }
  const output = args.output ?? 'artifacts/release-integrity.json'
  let evidence

  try {
    if (!options.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is missing')
    if (!options.token) throw new Error('CLOUDFLARE_API_TOKEN is missing')
    if (!options.repository) throw new Error('GITHUB_REPOSITORY is missing')
    if (!options.sha) throw new Error('GITHUB_SHA must be a full 40-character commit SHA')
    if (options.branch !== 'main') throw new Error(`BC-R23 requires main; received ${options.branch || 'empty'}`)
    if (Boolean(options.previewBranch) !== Boolean(options.previewSha)) {
      throw new Error('Preview proof requires both --expected-preview-branch and --expected-preview-sha')
    }
    if (options.previewBranch === options.branch) {
      throw new Error('Preview proof branch must not be main')
    }
    if (!Number.isInteger(options.waitSeconds) || options.waitSeconds < 0 || options.waitSeconds > 1800) {
      throw new Error('--wait-seconds must be between 0 and 1800')
    }
    if (!Number.isInteger(options.pollSeconds) || options.pollSeconds < 5 || options.pollSeconds > 60) {
      throw new Error('--poll-seconds must be between 5 and 60')
    }
    evidence = await auditCloudflareProduction(options)
  } catch (error) {
    evidence = baseFailureEvidence(options, error)
  }

  const destination = await writeEvidence(output, evidence)
  const conclusion = evidence.execution.conclusion
  console.log(`BestCode production source audit: ${conclusion}`)
  console.log(`Evidence: ${destination}`)
  for (const worker of evidence.workers ?? []) {
    console.log(`${worker.name}: trigger=${worker.trigger_policy.ok ? 'ok' : 'failed'} active=${worker.release?.state ?? 'unknown'} preview=${worker.preview_probe?.state ?? 'not-requested'}`)
    for (const item of [
      ...(worker.trigger_policy.violations ?? []),
      ...(worker.release?.violations ?? []),
      ...(worker.preview_probe?.violations ?? []),
    ]) {
      console.error(`${item.code}: ${item.message}`)
    }
  }
  if (conclusion !== 'success') process.exitCode = 1
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(resolve(process.argv[1])).href

if (isEntryPoint) await runCli()
