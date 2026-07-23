import assert from 'node:assert/strict'
import test from 'node:test'

import { isTransientCloudflareDeployLag } from './cloudflare-release-integrity-retry.mjs'

function evidenceFor(release, triggerOk = true) {
  return {
    execution: { conclusion: 'failure' },
    scope: { branch: 'main' },
    workers: [{
      trigger_policy: { ok: triggerOk },
      release,
    }],
  }
}

test('retries a stale but otherwise valid main deployment', () => {
  const evidence = evidenceFor({
    ok: false,
    state: 'stale_main',
    retryable: true,
    violations: [{ code: 'BC-R23-ACTIVE-SHA-MISMATCH' }],
  })
  assert.equal(isTransientCloudflareDeployLag(evidence), true)
})

test('retries an in-progress main build whose mapped SHA is still stale', () => {
  const evidence = evidenceFor({
    ok: false,
    state: 'source_mismatch',
    retryable: false,
    violations: [
      { code: 'BC-R23-BUILD-NOT-SUCCESS' },
      { code: 'BC-R23-ACTIVE-SHA-MISMATCH' },
    ],
    active_build: {
      outcome: null,
      branch: 'main',
      deploy_mode: 'production_deploy',
    },
  })
  assert.equal(isTransientCloudflareDeployLag(evidence), true)
})

test('does not retry failed, unsafe, or traffic-split production states', () => {
  const failedBuild = evidenceFor({
    ok: false,
    state: 'source_mismatch',
    retryable: false,
    violations: [
      { code: 'BC-R23-BUILD-NOT-SUCCESS' },
      { code: 'BC-R23-ACTIVE-SHA-MISMATCH' },
    ],
    active_build: {
      outcome: 'failure',
      branch: 'main',
      deploy_mode: 'production_deploy',
    },
  })
  assert.equal(isTransientCloudflareDeployLag(failedBuild), false)

  const wrongBranch = evidenceFor({
    ok: false,
    state: 'source_mismatch',
    retryable: false,
    violations: [{ code: 'BC-R23-ACTIVE-BRANCH-MISMATCH' }],
    active_build: {
      outcome: null,
      branch: 'agent/unsafe',
      deploy_mode: 'production_deploy',
    },
  })
  assert.equal(isTransientCloudflareDeployLag(wrongBranch), false)

  const trafficSplit = evidenceFor({
    ok: false,
    state: 'source_mismatch',
    retryable: false,
    violations: [
      { code: 'BC-R23-TRAFFIC-SPLIT' },
      { code: 'BC-R23-ACTIVE-SHA-MISMATCH' },
    ],
    active_build: {
      outcome: null,
      branch: 'main',
      deploy_mode: 'production_deploy',
    },
  })
  assert.equal(isTransientCloudflareDeployLag(trafficSplit), false)

  assert.equal(isTransientCloudflareDeployLag(evidenceFor({ state: 'stale_main', retryable: true }, false)), false)
})

test('does not retry successful evidence or malformed evidence', () => {
  assert.equal(isTransientCloudflareDeployLag({ execution: { conclusion: 'success' }, workers: [] }), false)
  assert.equal(isTransientCloudflareDeployLag(null), false)
})
