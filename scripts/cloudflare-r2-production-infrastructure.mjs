#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'
const DEFAULT_BUCKET = 'best-code-ide-assets-prod'
const DEFAULT_WORKER = 'best-code-ide'

function boundedText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => boundedText(item, 160)).filter(Boolean))].sort()
    : []
}

function sameStrings(left, right) {
  const a = normalizeStrings(left)
  const b = normalizeStrings(right)
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function sanitizeTrigger(value) {
  const trigger = value && typeof value === 'object' ? value : {}
  return {
    trigger_uuid: boundedText(trigger.trigger_uuid, 80) || null,
    trigger_name: boundedText(trigger.trigger_name, 160) || null,
    branch_includes: normalizeStrings(trigger.branch_includes),
    branch_excludes: normalizeStrings(trigger.branch_excludes),
    deploy_command: boundedText(trigger.deploy_command, 500) || null,
    root_directory: boundedText(trigger.root_directory, 240).replace(/^\/+|\/+$/g, ''),
    deleted_on: boundedText(trigger.deleted_on, 80) || null,
  }
}

export function classifyBackendTriggers(rawTriggers, productionBranch = 'main') {
  const active = (Array.isArray(rawTriggers) ? rawTriggers : [])
    .map(sanitizeTrigger)
    .filter((trigger) => !trigger.deleted_on)
  const production = []
  const preview = []
  const unknown = []
  for (const trigger of active) {
    if (sameStrings(trigger.branch_includes, [productionBranch]) && sameStrings(trigger.branch_excludes, [])) {
      production.push(trigger)
    } else if (sameStrings(trigger.branch_includes, ['*']) && sameStrings(trigger.branch_excludes, [productionBranch])) {
      preview.push(trigger)
    } else {
      unknown.push(trigger)
    }
  }
  return { production, preview, unknown }
}

function sanitizeBucket(value) {
  const bucket = value && typeof value === 'object' ? value : {}
  return {
    name: boundedText(bucket.name, 64) || null,
    storage_class: boundedText(bucket.storage_class ?? bucket.storageClass, 40) || null,
    location: boundedText(bucket.location, 40) || null,
    jurisdiction: boundedText(bucket.jurisdiction, 40) || null,
    creation_date: boundedText(bucket.creation_date, 80) || null,
  }
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
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Cloudflare API ${response.status}: invalid JSON response`)
  }
  if (request.allowNotFound && response.status === 404) return null
  if (!response.ok || body?.success !== true) {
    const messages = Array.isArray(body?.errors)
      ? body.errors.map((item) => boundedText(item?.message, 300)).filter(Boolean).join('; ')
      : ''
    throw new Error(`Cloudflare API ${response.status}: ${messages || 'request failed'}`)
  }
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
    { name: boundedText(worker?.id ?? worker?.name, 160), tag: boundedText(worker?.tag, 80) },
  ]))
}

async function loadTriggers(workerTag, options) {
  return cloudflareRequest(
    `/accounts/${encodeURIComponent(options.accountId)}/builds/workers/${encodeURIComponent(workerTag)}/triggers`,
    options,
  )
}

async function ensureBucket(options) {
  const bucketPath = `/accounts/${encodeURIComponent(options.accountId)}/r2/buckets/${encodeURIComponent(options.bucketName)}`
  let raw = await cloudflareRequest(bucketPath, options, { allowNotFound: true })
  let created = false
  if (!raw) {
    raw = await cloudflareRequest(
      `/accounts/${encodeURIComponent(options.accountId)}/r2/buckets`,
      options,
      { method: 'POST', body: { name: options.bucketName, storageClass: 'Standard' } },
    )
    created = true
  }
  const bucket = sanitizeBucket(raw)
  if (bucket.name !== options.bucketName) throw new Error('Cloudflare R2 bucket name verification failed')
  if (bucket.storage_class && bucket.storage_class !== 'Standard') {
    throw new Error(`Cloudflare R2 bucket storage class must be Standard; received ${bucket.storage_class}`)
  }
  return { created, bucket: { ...bucket, storage_class: bucket.storage_class || 'Standard' } }
}

export async function applyR2ProductionInfrastructure(options) {
  const checkedAt = new Date().toISOString()
  const workerIndex = await loadWorkerIndex(options)
  const worker = workerIndex.get(options.workerName)
  if (!worker?.tag) throw new Error(`Cloudflare Worker ${options.workerName} was not found`)

  const beforeRaw = await loadTriggers(worker.tag, options)
  const before = classifyBackendTriggers(beforeRaw, options.productionBranch)
  if (before.production.length !== 1) {
    throw new Error(`Expected exactly one ${options.productionBranch} production trigger; found ${before.production.length}`)
  }
  if (before.unknown.length > 0) {
    throw new Error(`Refusing to delete unknown backend triggers; found ${before.unknown.length}`)
  }

  const deleted = []
  for (const trigger of before.preview) {
    if (!trigger.trigger_uuid) throw new Error('Backend preview trigger is missing trigger_uuid')
    await cloudflareRequest(
      `/accounts/${encodeURIComponent(options.accountId)}/builds/triggers/${encodeURIComponent(trigger.trigger_uuid)}`,
      options,
      { method: 'DELETE' },
    )
    deleted.push({ trigger_uuid: trigger.trigger_uuid, trigger_name: trigger.trigger_name })
  }

  const afterRaw = await loadTriggers(worker.tag, options)
  const after = classifyBackendTriggers(afterRaw, options.productionBranch)
  if (after.production.length !== 1 || after.preview.length !== 0 || after.unknown.length !== 0) {
    throw new Error('Backend preview trigger disable verification failed closed')
  }

  const bucketResult = await ensureBucket(options)
  return {
    evidence_id: `ev_r2_infra_${boundedText(options.runId, 80) || Date.now()}`,
    schema_version: 1,
    type: 'r2_production_infrastructure',
    project_id: 'bestcode',
    producer: {
      actor_type: 'ci',
      actor_id: 'github-actions',
      tool: 'scripts/cloudflare-r2-production-infrastructure.mjs',
      tool_version: '1.0.0',
    },
    scope: {
      repository: options.repository,
      branch: options.productionBranch,
      backend_worker: options.workerName,
      bucket_name: options.bucketName,
    },
    execution: {
      checked_at: checkedAt,
      conclusion: 'success',
    },
    security: {
      redaction_applied: true,
      public_bucket_access_enabled: false,
      sensitivity: 'internal',
    },
    backend_preview_trigger: {
      before: {
        production_count: before.production.length,
        preview_count: before.preview.length,
        unknown_count: before.unknown.length,
      },
      deleted,
      after: {
        production_count: after.production.length,
        preview_count: after.preview.length,
        unknown_count: after.unknown.length,
      },
    },
    bucket: {
      ...bucketResult.bucket,
      created: bucketResult.created,
    },
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

function failureEvidence(options, error) {
  return {
    evidence_id: `ev_r2_infra_${boundedText(options.runId, 80) || Date.now()}`,
    schema_version: 1,
    type: 'r2_production_infrastructure',
    project_id: 'bestcode',
    scope: {
      repository: options.repository || null,
      branch: options.productionBranch || null,
      backend_worker: options.workerName || null,
      bucket_name: options.bucketName || null,
    },
    execution: {
      checked_at: new Date().toISOString(),
      conclusion: 'blocked',
      error: boundedText(error instanceof Error ? error.message : String(error), 500),
    },
    security: { redaction_applied: true, sensitivity: 'internal' },
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
    repository: boundedText(process.env.GITHUB_REPOSITORY, 240),
    productionBranch: boundedText(args['production-branch'] ?? 'main', 160),
    workerName: boundedText(args['worker-name'] ?? DEFAULT_WORKER, 160),
    bucketName: boundedText(args['bucket-name'] ?? DEFAULT_BUCKET, 64),
    runId: boundedText(process.env.GITHUB_RUN_ID, 80),
    fetchImpl: globalThis.fetch,
  }
  const output = args.output ?? 'artifacts/r2-production-infrastructure.json'
  let evidence
  try {
    if (!options.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is missing')
    if (!options.token) throw new Error('CLOUDFLARE_API_TOKEN is missing')
    if (!options.repository) throw new Error('GITHUB_REPOSITORY is missing')
    if (options.productionBranch !== 'main') throw new Error('Production branch must be main')
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(options.bucketName)) throw new Error('R2 bucket name is invalid')
    evidence = await applyR2ProductionInfrastructure(options)
  } catch (error) {
    evidence = failureEvidence(options, error)
  }
  const destination = await writeEvidence(output, evidence)
  console.log(`BestCode R2 infrastructure: ${evidence.execution.conclusion}`)
  console.log(`Evidence: ${destination}`)
  if (evidence.execution.conclusion !== 'success') process.exitCode = 1
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(resolve(process.argv[1])).href

if (isEntryPoint) await runCli()
