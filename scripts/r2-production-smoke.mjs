#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_BACKEND_URL = 'https://best-code-ide.enkhbat194.workers.dev'

function boundedText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeRunKey(value) {
  const normalized = boundedText(value, 40).replace(/[^A-Za-z0-9_-]/g, '-')
  if (!normalized) throw new Error('Smoke run key is required')
  return normalized
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function parseJson(response, label) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

async function expectJson(response, expectedStatus, label) {
  const body = await parseJson(response, label)
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected HTTP ${expectedStatus}, received ${response.status}: ${boundedText(body?.error ?? JSON.stringify(body), 300)}`)
  }
  return body
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra }
}

export async function runProductionSmoke(options) {
  const startedAt = new Date().toISOString()
  const runKey = safeRunKey(options.runKey)
  const assetId = `asset-r2-smoke-${runKey}`.slice(0, 64)
  const duplicateId = `asset-r2-dup-${runKey}`.slice(0, 64)
  const fixture = new TextEncoder().encode(`BestCode private R2 smoke fixture\nrun=${runKey}\n`)
  const sha256 = sha256Hex(fixture)
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const contentPath = `/api/brain/assets/${assetId}/content`
  const metadataPath = `/api/brain/assets/${assetId}`
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let metadataCreated = false
  let primaryError = null
  let cleanup = { attempted: false, deleted: false, get_after_delete_status: null, metadata_status: null }

  const request = (path, init = {}) => fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: authHeaders(options.token, init.headers),
  })

  try {
    const createBody = {
      asset_id: assetId,
      project_id: 'bestcode',
      filename: `r2-smoke-${runKey}.bin`,
      display_name: `R2 production smoke ${runKey}`,
      media_type: 'application/octet-stream',
      size_bytes: fixture.byteLength,
      sha256,
      origin: 'owner_upload',
      sensitivity: 'private',
      idempotency_key: assetId,
      created_by: 'github-actions',
    }
    const created = await expectJson(await request('/api/brain/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    }), 201, 'asset metadata create')
    if (created?.asset?.asset_id !== assetId || created?.asset?.upload_status !== 'pending') {
      throw new Error('Asset metadata create did not return the expected pending asset')
    }
    metadataCreated = true

    const uploaded = await expectJson(await request(contentPath, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(fixture.byteLength),
      },
      body: fixture,
    }), 201, 'binary upload')
    if (uploaded?.asset?.upload_status !== 'stored' || uploaded?.asset?.storage_provider !== 'r2') {
      throw new Error('Binary upload did not commit stored R2 metadata')
    }
    if (uploaded?.object?.sha256 !== sha256 || uploaded?.object?.sizeBytes !== fixture.byteLength) {
      throw new Error('Binary upload response integrity does not match the fixture')
    }

    const head = await request(contentPath, { method: 'HEAD' })
    if (head.status !== 200) throw new Error(`Binary HEAD expected HTTP 200, received ${head.status}`)
    if (head.headers.get('Cache-Control') !== 'private, no-store') throw new Error('Binary HEAD Cache-Control is not private, no-store')
    if (head.headers.get('X-Content-Type-Options') !== 'nosniff') throw new Error('Binary HEAD is missing nosniff')
    if (!head.headers.get('Content-Disposition')?.startsWith('attachment;')) throw new Error('Binary HEAD is not attachment-only')
    if (head.headers.get('Content-Length') !== String(fixture.byteLength)) throw new Error('Binary HEAD Content-Length mismatch')

    const downloaded = await request(contentPath)
    if (downloaded.status !== 200) throw new Error(`Binary download expected HTTP 200, received ${downloaded.status}`)
    const downloadedBytes = new Uint8Array(await downloaded.arrayBuffer())
    if (downloadedBytes.byteLength !== fixture.byteLength) throw new Error('Downloaded fixture size mismatch')
    if (sha256Hex(downloadedBytes) !== sha256) throw new Error('Downloaded fixture SHA-256 mismatch')
    if (downloaded.headers.get('Cache-Control') !== 'private, no-store') throw new Error('Binary download Cache-Control is not private, no-store')
    if (downloaded.headers.get('X-Content-Type-Options') !== 'nosniff') throw new Error('Binary download is missing nosniff')

    const duplicate = await expectJson(await request('/api/brain/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...createBody, asset_id: duplicateId, idempotency_key: duplicateId }),
    }), 200, 'duplicate metadata create')
    if (duplicate?.duplicate !== true || duplicate?.reused_asset_id !== assetId) {
      throw new Error('Duplicate metadata did not reuse the stored asset')
    }

    return {
      evidence_id: `ev_r2_smoke_${runKey}`,
      schema_version: 1,
      type: 'r2_production_smoke',
      project_id: 'bestcode',
      producer: { actor_type: 'ci', actor_id: 'github-actions', tool: 'scripts/r2-production-smoke.mjs', tool_version: '1.0.0' },
      scope: { backend_url: baseUrl, asset_id: assetId, duplicate_asset_id: duplicateId },
      execution: { started_at: startedAt, completed_at: new Date().toISOString(), conclusion: 'success' },
      integrity: { sha256, size_bytes: fixture.byteLength, media_type: 'application/octet-stream' },
      checks: {
        metadata_created: true,
        binary_uploaded: true,
        head_private: true,
        download_verified: true,
        duplicate_reused: true,
      },
      security: { redaction_applied: true, public_url_used: false, sensitivity: 'internal' },
      cleanup,
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (metadataCreated) {
      cleanup.attempted = true
      try {
        const deleted = await expectJson(await request(contentPath, { method: 'DELETE' }), 200, 'binary delete')
        cleanup.deleted = deleted?.deleted === true
        const missing = await request(contentPath)
        cleanup.get_after_delete_status = missing.status
        if (missing.status !== 404) throw new Error(`Binary GET after delete expected HTTP 404, received ${missing.status}`)
        const metadata = await expectJson(await request(metadataPath), 200, 'deleted asset metadata read')
        cleanup.metadata_status = metadata?.upload_status ?? null
        if (cleanup.metadata_status !== 'deleted') throw new Error('Deleted asset metadata did not reach deleted status')
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        if (primaryError) throw new Error(`${primaryError instanceof Error ? primaryError.message : String(primaryError)}; cleanup failed: ${message}`)
        throw cleanupError
      }
    }
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

async function writeEvidence(output, evidence) {
  const destination = resolve(output)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  return destination
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2))
  const token = boundedText(process.env.BESTCODE_AUTH_TOKEN, 4096)
  const baseUrl = boundedText(args['backend-url'] ?? process.env.BESTCODE_BACKEND_URL ?? DEFAULT_BACKEND_URL, 300)
  const runKey = boundedText(args['run-key'] ?? `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`, 80)
  const output = args.output ?? 'artifacts/r2-production-smoke.json'
  if (!token) throw new Error('BESTCODE_AUTH_TOKEN is missing')
  if (!/^https:\/\//.test(baseUrl)) throw new Error('Production backend URL must use HTTPS')
  const evidence = await runProductionSmoke({ token, baseUrl, runKey, fetchImpl: globalThis.fetch })
  const destination = await writeEvidence(output, evidence)
  console.log('BestCode R2 production smoke: success')
  console.log(`Evidence: ${destination}`)
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(resolve(process.argv[1])).href

if (isEntryPoint) await runCli()
