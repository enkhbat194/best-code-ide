import assert from 'node:assert/strict'
import test from 'node:test'
import { applyR2ProductionInfrastructure, classifyBackendTriggers } from './cloudflare-r2-production-infrastructure.mjs'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function options(fetchImpl) {
  return {
    accountId: 'account-123',
    token: 'secret-token',
    repository: 'enkhbat194/best-code-ide',
    productionBranch: 'main',
    workerName: 'best-code-ide',
    bucketName: 'best-code-ide-assets-prod',
    runId: '42',
    fetchImpl,
  }
}

const production = {
  trigger_uuid: 'prod-uuid',
  trigger_name: 'Production',
  branch_includes: ['main'],
  branch_excludes: [],
  deploy_command: 'npx wrangler deploy',
}
const preview = {
  trigger_uuid: 'preview-uuid',
  trigger_name: 'Preview',
  branch_includes: ['*'],
  branch_excludes: ['main'],
  deploy_command: 'npx wrangler versions upload',
}

test('classifies exact production, preview, and unknown trigger contracts', () => {
  const result = classifyBackendTriggers([production, preview, { branch_includes: ['dev'], branch_excludes: [] }])
  assert.equal(result.production.length, 1)
  assert.equal(result.preview.length, 1)
  assert.equal(result.unknown.length, 1)
})

test('creates Standard private bucket before deleting backend preview trigger', async () => {
  const calls = []
  let deleted = false
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/workers/scripts')) return jsonResponse(200, { success: true, result: [{ id: 'best-code-ide', tag: 'worker-tag' }] })
    if (url.endsWith('/builds/workers/worker-tag/triggers')) {
      return jsonResponse(200, { success: true, result: deleted ? [production] : [production, preview] })
    }
    if (url.endsWith('/builds/triggers/preview-uuid') && init.method === 'DELETE') {
      deleted = true
      return jsonResponse(200, { success: true, result: null })
    }
    if (url.endsWith('/r2/buckets/best-code-ide-assets-prod')) {
      return jsonResponse(404, { success: false, errors: [{ message: 'not found' }] })
    }
    if (url.endsWith('/r2/buckets') && init.method === 'POST') {
      return jsonResponse(200, {
        success: true,
        result: { name: 'best-code-ide-assets-prod', storage_class: 'Standard', location: 'apac' },
      })
    }
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`)
  }

  const evidence = await applyR2ProductionInfrastructure(options(fetchImpl))
  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.backend_preview_trigger.deleted.length, 1)
  assert.equal(evidence.backend_preview_trigger.after.preview_count, 0)
  assert.equal(evidence.bucket.name, 'best-code-ide-assets-prod')
  assert.equal(evidence.bucket.storage_class, 'Standard')
  assert.equal(evidence.bucket.created, true)
  assert.equal(evidence.security.public_bucket_access_enabled, false)
  const bucketCreateIndex = calls.findIndex((call) => call.method === 'POST' && call.url.endsWith('/r2/buckets'))
  const previewDeleteIndex = calls.findIndex((call) => call.method === 'DELETE' && call.url.endsWith('/builds/triggers/preview-uuid'))
  assert.ok(bucketCreateIndex >= 0 && bucketCreateIndex < previewDeleteIndex)
})

test('leaves existing Standard bucket and absent preview trigger unchanged', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/workers/scripts')) return jsonResponse(200, { success: true, result: [{ id: 'best-code-ide', tag: 'worker-tag' }] })
    if (url.endsWith('/builds/workers/worker-tag/triggers')) return jsonResponse(200, { success: true, result: [production] })
    if (url.endsWith('/r2/buckets/best-code-ide-assets-prod')) {
      return jsonResponse(200, { success: true, result: { name: 'best-code-ide-assets-prod', storage_class: 'Standard' } })
    }
    throw new Error(`Unexpected request ${url}`)
  }
  const evidence = await applyR2ProductionInfrastructure(options(fetchImpl))
  assert.equal(evidence.backend_preview_trigger.deleted.length, 0)
  assert.equal(evidence.bucket.created, false)
})

test('fails closed rather than deleting an unknown backend trigger', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/workers/scripts')) return jsonResponse(200, { success: true, result: [{ id: 'best-code-ide', tag: 'worker-tag' }] })
    if (url.endsWith('/builds/workers/worker-tag/triggers')) {
      return jsonResponse(200, { success: true, result: [production, { trigger_uuid: 'unknown', branch_includes: ['dev'], branch_excludes: [] }] })
    }
    throw new Error(`Unexpected request ${url}`)
  }
  await assert.rejects(applyR2ProductionInfrastructure(options(fetchImpl)), /Refusing to delete unknown backend triggers/)
})
