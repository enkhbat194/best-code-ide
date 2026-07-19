import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditCloudflareProduction,
  assessActiveDeployment,
  assessTriggerPolicy,
  classifyDeployCommand,
  planPreviewTriggerRepairs,
  sanitizeTrigger,
} from './cloudflare-release-integrity.mjs'

const expected = {
  name: 'best-code-ide-appl',
  root_directory: 'frontend',
  repository: 'enkhbat194/best-code-ide',
  branch: 'main',
  sha: 'a'.repeat(40),
}

const repository = {
  provider_type: 'github',
  repo_name: 'enkhbat194/best-code-ide',
}

test('classifies only explicit Wrangler deploy and preview upload commands', () => {
  assert.equal(classifyDeployCommand('npx wrangler deploy'), 'production_deploy')
  assert.equal(classifyDeployCommand('npx wrangler@3.99.0 versions upload'), 'preview_upload')
  assert.equal(classifyDeployCommand('npm run deploy'), 'unknown')
})

test('accepts one main production trigger and an isolated preview trigger', () => {
  const result = assessTriggerPolicy([
    {
      trigger_uuid: 'production',
      branch_includes: ['main'],
      branch_excludes: [],
      deploy_command: 'npx wrangler deploy',
      root_directory: '/frontend',
      repo_connection: repository,
    },
    {
      trigger_uuid: 'preview',
      branch_includes: ['*'],
      branch_excludes: ['main'],
      deploy_command: 'npx wrangler versions upload',
      root_directory: 'frontend',
      repo_connection: repository,
    },
  ], expected)

  assert.equal(result.ok, true)
  assert.equal(result.preview_policy, 'versions_upload_only')
  assert.equal(result.observed_trigger_count, 2)
})

test('blocks wildcard production deploys and target mismatches', () => {
  const result = assessTriggerPolicy([
    {
      trigger_uuid: 'unsafe',
      branch_includes: ['*'],
      branch_excludes: [],
      deploy_command: 'npx wrangler deploy',
      root_directory: 'backend',
      repo_connection: { provider_type: 'gitlab', repo_name: 'someone/else' },
    },
  ], expected)

  assert.equal(result.ok, false)
  assert.ok(result.violations.some((item) => item.code === 'BC-R23-UNSAFE-BRANCH-FILTER'))
  assert.ok(result.violations.some((item) => item.code === 'BC-R23-PRODUCTION-TRIGGER-COUNT'))
})

test('repairs only an exact preview trigger aimed at the expected Worker target', () => {
  const repairs = planPreviewTriggerRepairs([
    {
      trigger_uuid: 'repair-me',
      branch_includes: ['*'],
      branch_excludes: ['main'],
      deploy_command: 'npx wrangler deploy',
      root_directory: 'frontend',
      repo_connection: repository,
    },
    {
      trigger_uuid: 'leave-unknown-filter-alone',
      branch_includes: ['agent/**'],
      branch_excludes: [],
      deploy_command: 'npx wrangler deploy',
      root_directory: 'frontend',
      repo_connection: repository,
    },
    {
      trigger_uuid: 'leave-wrong-repo-alone',
      branch_includes: ['*'],
      branch_excludes: ['main'],
      deploy_command: 'npx wrangler deploy',
      root_directory: 'frontend',
      repo_connection: { provider_type: 'github', repo_name: 'other/repository' },
    },
  ], expected)

  assert.deepEqual(repairs, [{
    trigger_uuid: 'repair-me',
    trigger_name: null,
    before: 'npx wrangler deploy',
    after: 'npx wrangler versions upload',
  }])
})

test('verifies exact active main SHA at 100 percent traffic', () => {
  const result = assessActiveDeployment([
    {
      id: 'deployment-id',
      created_on: '2026-07-19T00:00:00.000Z',
      source: 'api',
      strategy: 'percentage',
      versions: [{ version_id: 'version-id', percentage: 100 }],
    },
  ], {
    build_uuid: 'build-id',
    build_outcome: 'success',
    build_trigger_metadata: {
      branch: 'main',
      commit_hash: expected.sha,
      build_trigger_source: 'push',
      deploy_command: 'npx wrangler deploy',
      environment_variables: { MUST_NOT_LEAK: 'secret-value' },
    },
    trigger: {
      root_directory: 'frontend',
      repo_connection: repository,
    },
  }, expected)

  assert.equal(result.ok, true)
  assert.equal(result.state, 'verified_main')
  assert.equal(result.active_build.commit_sha, expected.sha)
  assert.equal(JSON.stringify(result).includes('secret-value'), false)
})

test('retries stale main but immediately blocks an active non-main branch', () => {
  const deployment = [{
    id: 'deployment-id',
    versions: [{ version_id: 'version-id', percentage: 100 }],
  }]
  const baseBuild = {
    build_outcome: 'success',
    build_trigger_metadata: {
      branch: 'main',
      commit_hash: 'b'.repeat(40),
      deploy_command: 'npx wrangler deploy',
    },
    trigger: { root_directory: 'frontend', repo_connection: repository },
  }

  const stale = assessActiveDeployment(deployment, baseBuild, expected)
  assert.equal(stale.state, 'stale_main')
  assert.equal(stale.retryable, true)

  const preview = assessActiveDeployment(deployment, {
    ...baseBuild,
    build_trigger_metadata: {
      ...baseBuild.build_trigger_metadata,
      branch: 'agent/unsafe',
      commit_hash: expected.sha,
    },
  }, expected)
  assert.equal(preview.state, 'source_mismatch')
  assert.equal(preview.retryable, false)
  assert.ok(preview.violations.some((item) => item.code === 'BC-R23-ACTIVE-BRANCH-MISMATCH'))
})

test('trigger evidence omits build token and environment values', () => {
  const sanitized = sanitizeTrigger({
    trigger_uuid: 'safe-id',
    branch_includes: ['main'],
    branch_excludes: [],
    deploy_command: 'npx wrangler deploy',
    root_directory: 'frontend',
    repo_connection: repository,
    build_token_uuid: 'private-token-id',
    environment_variables: { SECRET: 'do-not-copy' },
  })
  const serialized = JSON.stringify(sanitized)
  assert.equal(serialized.includes('private-token-id'), false)
  assert.equal(serialized.includes('do-not-copy'), false)
})

test('audits a Worker end to end through sanitized Cloudflare API responses', async () => {
  const requests = []
  const responseFor = (url) => {
    if (url.endsWith('/workers/scripts')) {
      return [{ id: expected.name, tag: 'worker-tag' }]
    }
    if (url.endsWith('/builds/workers/worker-tag/triggers')) {
      return [{
        trigger_uuid: 'production',
        branch_includes: ['main'],
        branch_excludes: [],
        deploy_command: 'npx wrangler deploy',
        root_directory: 'frontend',
        repo_connection: repository,
      }]
    }
    if (url.endsWith(`/workers/scripts/${expected.name}/deployments`)) {
      return {
        deployments: [{
          id: 'deployment-id',
          created_on: '2026-07-19T00:00:00.000Z',
          strategy: 'percentage',
          versions: [{ version_id: 'version-id', percentage: 100 }],
        }],
      }
    }
    if (url.endsWith('/builds/builds?version_ids=version-id')) {
      return {
        builds: {
          'version-id': {
            build_uuid: 'build-id',
            build_outcome: 'success',
            build_trigger_metadata: {
              branch: 'main',
              commit_hash: expected.sha,
              deploy_command: 'npx wrangler deploy',
            },
            trigger: { root_directory: 'frontend', repo_connection: repository },
          },
        },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  const fetchImpl = async (url, init) => {
    requests.push({ url, authorization: init.headers.Authorization })
    return new Response(JSON.stringify({ success: true, result: responseFor(url) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const evidence = await auditCloudflareProduction({
    accountId: 'account-id',
    token: 'private-api-token',
    repository: expected.repository,
    branch: expected.branch,
    sha: expected.sha,
    workers: [{ name: expected.name, root_directory: expected.root_directory }],
    waitSeconds: 0,
    pollSeconds: 5,
    runId: '123',
    fetchImpl,
  })

  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.workers[0].release.state, 'verified_main')
  assert.equal(requests.length, 4)
  assert.equal(JSON.stringify(evidence).includes('private-api-token'), false)
})

test('guarded repair patches an unsafe exact preview trigger before auditing', async () => {
  let previewCommand = 'npx wrangler deploy'
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body })
    let result
    if (url.endsWith('/workers/scripts')) {
      result = [{ id: expected.name, tag: 'worker-tag' }]
    } else if (url.endsWith('/builds/workers/worker-tag/triggers')) {
      result = [
        {
          trigger_uuid: 'production',
          branch_includes: ['main'],
          branch_excludes: [],
          deploy_command: 'npx wrangler deploy',
          root_directory: 'frontend',
          repo_connection: repository,
        },
        {
          trigger_uuid: 'preview',
          branch_includes: ['*'],
          branch_excludes: ['main'],
          deploy_command: previewCommand,
          root_directory: 'frontend',
          repo_connection: repository,
        },
      ]
    } else if (url.endsWith('/builds/triggers/preview') && init.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), { deploy_command: 'npx wrangler versions upload' })
      previewCommand = 'npx wrangler versions upload'
      result = {
        trigger_uuid: 'preview',
        branch_includes: ['*'],
        branch_excludes: ['main'],
        deploy_command: previewCommand,
        root_directory: 'frontend',
        repo_connection: repository,
      }
    } else if (url.endsWith(`/workers/scripts/${expected.name}/deployments`)) {
      result = { deployments: [{ id: 'deployment-id', versions: [{ version_id: 'version-id', percentage: 100 }] }] }
    } else if (url.endsWith('/builds/builds?version_ids=version-id')) {
      result = { builds: { 'version-id': {
        build_outcome: 'success',
        build_trigger_metadata: {
          branch: 'main',
          commit_hash: expected.sha,
          deploy_command: 'npx wrangler deploy',
        },
        trigger: { root_directory: 'frontend', repo_connection: repository },
      } } }
    } else {
      throw new Error(`Unexpected request: ${url}`)
    }
    return new Response(JSON.stringify({ success: true, result }), { status: 200 })
  }

  const evidence = await auditCloudflareProduction({
    accountId: 'account-id',
    token: 'private-api-token',
    repository: expected.repository,
    branch: expected.branch,
    sha: expected.sha,
    workers: [{ name: expected.name, root_directory: expected.root_directory }],
    repairPreviewTriggers: true,
    waitSeconds: 0,
    pollSeconds: 5,
    runId: 'repair-run',
    fetchImpl,
  })

  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.repairs.length, 1)
  assert.equal(evidence.repairs[0].trigger_uuid, 'preview')
  assert.equal(evidence.workers[0].trigger_policy.ok, true)
  assert.equal(requests.filter((request) => request.method === 'PATCH').length, 1)
})
