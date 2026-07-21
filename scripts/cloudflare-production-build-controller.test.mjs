import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  deliverProductionBuilds,
  selectProductionTrigger,
} from './cloudflare-production-build-controller.mjs'

const expectedSha = 'a'.repeat(40)
const oldSha = 'b'.repeat(40)
const repository = {
  provider_type: 'github',
  repo_name: 'enkhbat194/best-code-ide',
}
const worker = { name: 'best-code-ide-appl', root_directory: 'frontend' }
const expected = {
  ...worker,
  repository: 'enkhbat194/best-code-ide',
  branch: 'main',
  sha: expectedSha,
}

function productionTrigger() {
  return {
    trigger_uuid: '00000000-0000-4000-8000-000000000001',
    trigger_name: 'Production Deploy',
    branch_includes: ['main'],
    branch_excludes: [],
    deploy_command: 'npx wrangler deploy',
    root_directory: 'frontend',
    repo_connection: repository,
  }
}

function activeBuild(sha) {
  return {
    build_uuid: '00000000-0000-4000-8000-000000000010',
    build_outcome: 'success',
    status: 'stopped',
    build_trigger_metadata: {
      branch: 'main',
      commit_hash: sha,
      build_trigger_source: 'api',
      deploy_command: 'npx wrangler deploy',
    },
    trigger: {
      root_directory: 'frontend',
      repo_connection: repository,
    },
  }
}

function response(result) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('selects only the exact main production trigger', () => {
  const selected = selectProductionTrigger([
    productionTrigger(),
    {
      ...productionTrigger(),
      trigger_uuid: '00000000-0000-4000-8000-000000000002',
      branch_includes: ['*'],
      branch_excludes: ['main'],
      deploy_command: 'npx wrangler versions upload',
    },
  ], expected)

  assert.equal(selected.trigger_uuid, productionTrigger().trigger_uuid)
  assert.throws(() => selectProductionTrigger([{
    ...productionTrigger(),
    branch_includes: ['*'],
    branch_excludes: [],
  }], expected), /production trigger policy invalid/)
})

test('triggers an exact manual build when webhook delivery left production stale', async () => {
  const requests = []
  let activeVersion = 'old-version'

  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body })
    if (url.endsWith('/workers/scripts')) {
      return response([{ id: worker.name, tag: 'worker-tag' }])
    }
    if (url.endsWith('/builds/workers/worker-tag/triggers')) {
      return response([productionTrigger()])
    }
    if (url.endsWith(`/workers/scripts/${worker.name}/deployments`)) {
      return response({
        deployments: [{
          id: 'deployment-id',
          versions: [{ version_id: activeVersion, percentage: 100 }],
        }],
      })
    }
    if (url.endsWith('/builds/builds?version_ids=old-version')) {
      return response({ builds: { 'old-version': activeBuild(oldSha) } })
    }
    if (url.endsWith(`/builds/triggers/${productionTrigger().trigger_uuid}/builds`) && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { branch: 'main', commit_hash: expectedSha })
      return response({
        build_uuid: '00000000-0000-4000-8000-000000000020',
        status: 'queued',
        already_exists: false,
      })
    }
    if (url.endsWith('/builds/builds/00000000-0000-4000-8000-000000000020')) {
      activeVersion = 'new-version'
      return response({
        build_uuid: '00000000-0000-4000-8000-000000000020',
        status: 'stopped',
        build_outcome: 'success',
      })
    }
    if (url.endsWith('/builds/builds?version_ids=new-version')) {
      return response({ builds: { 'new-version': activeBuild(expectedSha) } })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const evidence = await deliverProductionBuilds({
    accountId: 'account-id',
    token: 'private-token',
    repository: expected.repository,
    branch: 'main',
    sha: expectedSha,
    workers: [worker],
    waitSeconds: 30,
    pollSeconds: 5,
    runId: 'delivery-test',
    fetchImpl,
    sleepImpl: async () => {},
  })

  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.deliveries[0].action, 'manual_build_created')
  assert.equal(evidence.deliveries[0].activation.state, 'verified_main')
  assert.equal(requests.filter((request) => request.method === 'POST').length, 1)
  assert.equal(JSON.stringify(evidence).includes('private-token'), false)
})

test('does not create a duplicate build when exact main is already active', async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method })
    if (url.endsWith('/workers/scripts')) return response([{ id: worker.name, tag: 'worker-tag' }])
    if (url.endsWith('/builds/workers/worker-tag/triggers')) return response([productionTrigger()])
    if (url.endsWith(`/workers/scripts/${worker.name}/deployments`)) {
      return response({ deployments: [{ id: 'deployment-id', versions: [{ version_id: 'current-version', percentage: 100 }] }] })
    }
    if (url.endsWith('/builds/builds?version_ids=current-version')) {
      return response({ builds: { 'current-version': activeBuild(expectedSha) } })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const evidence = await deliverProductionBuilds({
    accountId: 'account-id',
    token: 'private-token',
    repository: expected.repository,
    branch: 'main',
    sha: expectedSha,
    workers: [worker],
    waitSeconds: 30,
    pollSeconds: 5,
    runId: 'already-active-test',
    fetchImpl,
  })

  assert.equal(evidence.deliveries[0].action, 'already_active')
  assert.equal(requests.some((request) => request.method === 'POST'), false)
})

test('main delivery workflow uses the exact SHA and immutable evidence', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-delivery.yml', import.meta.url), 'utf8')
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/)
  assert.match(workflow, /--expected-sha "\$GITHUB_SHA"/)
  assert.match(workflow, /cloudflare-production-build-controller\.mjs/)
  assert.match(workflow, /production-delivery-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/)
  assert.doesNotMatch(workflow, /wrangler\s+deploy/)
})
