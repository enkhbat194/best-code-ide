import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiRequest,
  createDeployment,
  rehearseRollback,
  selectRollbackCandidate,
  validateCurrentDeployment,
} from './cloudflare-rollback-controller.mjs'

const currentVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const candidateVersion = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const previewVersion = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const currentSha = 'a'.repeat(40)
const candidateSha = 'b'.repeat(40)

const expected = {
  repository: 'enkhbat194/best-code-ide',
  root_directory: 'backend',
  main_sha: currentSha,
}

function deployment(id, versionId, percentage = 100) {
  return {
    id,
    created_on: '2026-07-19T00:00:00.000Z',
    versions: [{ version_id: versionId, percentage }],
  }
}

function build(branch, sha, deployCommand = 'npx wrangler deploy') {
  return {
    build_uuid: `build-${sha.slice(0, 8)}`,
    build_outcome: 'success',
    build_trigger_metadata: {
      branch,
      commit_hash: sha,
      deploy_command: deployCommand,
    },
    trigger: {
      root_directory: 'backend',
      repo_connection: { provider_type: 'github', repo_name: 'best-code-ide' },
    },
  }
}

test('validates current production only at exact main SHA and 100% traffic', () => {
  const deployments = [deployment('11111111-1111-4111-8111-111111111111', currentVersion)]
  const builds = { [currentVersion]: build('main', currentSha) }
  const current = validateCurrentDeployment(deployments, builds, expected)

  assert.equal(current.version_id, currentVersion)
  assert.equal(current.commit_sha, currentSha)
  assert.throws(
    () => validateCurrentDeployment([deployment('11111111-1111-4111-8111-111111111111', currentVersion, 50)], builds, expected),
    /100%/,
  )
})

test('selects the newest previous main ancestor and ignores preview uploads', () => {
  const deployments = [
    deployment('11111111-1111-4111-8111-111111111111', currentVersion),
    deployment('22222222-2222-4222-8222-222222222222', previewVersion),
    deployment('33333333-3333-4333-8333-333333333333', candidateVersion),
  ]
  const builds = {
    [currentVersion]: build('main', currentSha),
    [previewVersion]: build('agent/probe', 'c'.repeat(40), 'npx wrangler versions upload'),
    [candidateVersion]: build('main', candidateSha),
  }
  const candidate = selectRollbackCandidate(deployments, builds, expected, new Set([candidateSha]))

  assert.equal(candidate.version_id, candidateVersion)
  assert.equal(candidate.commit_sha, candidateSha)
  assert.equal(selectRollbackCandidate(deployments, builds, expected, new Set()), null)
})

test('rollback rehearsal activates exact target, smokes it, and restores current version', async () => {
  const calls = []
  const result = await rehearseRollback({
    current: { version_id: currentVersion, commit_sha: currentSha },
    candidate: { version_id: candidateVersion, commit_sha: candidateSha },
    deploy: async (versionId) => {
      calls.push(`deploy:${versionId}`)
      return { id: versionId === candidateVersion
        ? '44444444-4444-4444-8444-444444444444'
        : '55555555-5555-4555-8555-555555555555' }
    },
    poll: async (versionId) => calls.push(`poll:${versionId}`),
    smoke: async (stage) => {
      calls.push(`smoke:${stage}`)
      return { stage, ok: true, status: 200 }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.restored, true)
  assert.deepEqual(calls, [
    `deploy:${candidateVersion}`,
    `poll:${candidateVersion}`,
    'smoke:rollback',
    `deploy:${currentVersion}`,
    `poll:${currentVersion}`,
    'smoke:restore',
  ])
})

test('rollback rehearsal restores current version even when rollback smoke fails', async () => {
  const calls = []
  const result = await rehearseRollback({
    current: { version_id: currentVersion, commit_sha: currentSha },
    candidate: { version_id: candidateVersion, commit_sha: candidateSha },
    deploy: async (versionId) => {
      calls.push(`deploy:${versionId}`)
      return { id: '66666666-6666-4666-8666-666666666666' }
    },
    poll: async (versionId) => calls.push(`poll:${versionId}`),
    smoke: async (stage) => {
      calls.push(`smoke:${stage}`)
      if (stage === 'rollback') throw new Error('synthetic smoke failure')
      return { stage, ok: true, status: 200 }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.restored, true)
  assert.match(result.primary_error, /synthetic smoke failure/)
  assert.ok(calls.includes(`deploy:${currentVersion}`))
  assert.ok(calls.includes('smoke:restore'))
})

test('rollback rehearsal never overwrites an unexpected concurrent deployment', async () => {
  const concurrentVersion = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const calls = []
  const result = await rehearseRollback({
    current: { version_id: currentVersion, commit_sha: currentSha },
    candidate: { version_id: candidateVersion, commit_sha: candidateSha },
    deploy: async (versionId) => {
      calls.push(`deploy:${versionId}`)
      return { id: '77777777-7777-4777-8777-777777777777' }
    },
    poll: async (versionId) => calls.push(`poll:${versionId}`),
    smoke: async (stage) => ({ stage, ok: true, status: 200 }),
    getActive: async () => concurrentVersion,
  })

  assert.equal(result.ok, false)
  assert.equal(result.restored, false)
  assert.match(result.restore_error, /changed concurrently/)
  assert.deepEqual(calls.filter((call) => call.startsWith('deploy:')), [`deploy:${candidateVersion}`])
})

test('deployment creation explicitly forces an exact previous version without custom trigger annotations', async () => {
  let capturedUrl
  let capturedRequest
  const deploymentId = '88888888-8888-4888-8888-888888888888'
  const result = await createDeployment(
    { name: 'best-code-ide' },
    candidateVersion,
    'BestCode rollback rehearsal',
    {
      accountId: 'account-id',
      cloudflareToken: 'test-token',
      fetchImpl: async (url, request) => {
        capturedUrl = url
        capturedRequest = request
        return new Response(JSON.stringify({ success: true, result: { id: deploymentId } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  )

  assert.equal(result.id, deploymentId)
  assert.match(capturedUrl, /\/deployments\?force=true$/)
  assert.deepEqual(JSON.parse(capturedRequest.body), {
    strategy: 'percentage',
    versions: [{ percentage: 100, version_id: candidateVersion }],
    annotations: { 'workers/message': 'BestCode rollback rehearsal' },
  })
})

test('Cloudflare API failures preserve only bounded code and message diagnostics', async () => {
  await assert.rejects(
    apiRequest('https://api.cloudflare.test/deployments', {
      token: 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        errors: [{ code: 10220, message: 'Use force to deploy an older version.' }],
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    }),
    /API 400: code 10220: Use force to deploy an older version\./,
  )
})
