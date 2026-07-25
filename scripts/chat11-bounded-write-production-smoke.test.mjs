import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  SMOKE_ALLOWED_TOOLS,
  assertEvidenceSafe,
  buildSmokeFixture,
  deterministicHash,
  runBoundedWriteProductionSmoke,
} from './chat11-bounded-write-production-smoke.mjs'

const SHA = '554908b69fa855e2292a88357c67fc340e457370'

test('fixture is deterministic and locked to one docs/smoke file contract', () => {
  const first = buildSmokeFixture('run-123-attempt-1', SHA)
  const second = buildSmokeFixture('run-123-attempt-1', SHA)
  assert.deepEqual(first, second)
  assert.match(first.branch, /^agent\/chat11-smoke-[a-f0-9]{16}$/)
  assert.match(first.path, /^docs\/smoke\/chat11-[a-f0-9]{16}\.md$/)
  assert.deepEqual(first.task.scope, ['docs/smoke/**'])
  assert.equal(first.task.safety_class, 'approval-required')
  assert.equal(first.task.max_attempts, 1)
  assert.equal(first.task.approval_requirement, 'chat11_bounded_write_smoke')
  assert.equal(first.plan.deterministic_hash, deterministicHash(first.plan))
  assert.ok(SMOKE_ALLOWED_TOOLS.includes('repository_apply_patch'))
  assert.ok(SMOKE_ALLOWED_TOOLS.includes('mission_task_result_submit'))
  assert.ok(!SMOKE_ALLOWED_TOOLS.includes('deployment_start'))
  assert.ok(!SMOKE_ALLOWED_TOOLS.includes('rollback_request'))
})

test('failure evidence redacts owner and GitHub secrets', async () => {
  const ownerSecret = 'owner-secret-chat11-sentinel'
  const githubSecret = 'github-secret-chat11-sentinel'
  const evidence = await runBoundedWriteProductionSmoke({
    backendUrl: 'https://bestcode.test',
    ownerToken: ownerSecret,
    githubToken: githubSecret,
    repository: 'enkhbat194/best-code-ide',
    expectedSha: SHA,
    runKey: 'failure-redaction',
    fetchImpl: async () => new Response(JSON.stringify({
      error: `Authorization: Bearer ${ownerSecret} ${githubSecret}`,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
  })
  const serialized = JSON.stringify(evidence)
  assert.equal(evidence.execution.conclusion, 'failure')
  assert.doesNotMatch(serialized, new RegExp(ownerSecret))
  assert.doesNotMatch(serialized, new RegExp(githubSecret))
  assert.doesNotMatch(serialized, /authorization/i)
  assert.doesNotMatch(serialized, /bearer\s/i)
  assert.doesNotThrow(() => assertEvidenceSafe(evidence, [ownerSecret, githubSecret]))
})

test('evidence leak guard rejects bounded credential, secret, and sensitive header markers', () => {
  assert.throws(() => assertEvidenceSafe({ value: 'bcwrite_v1.id.secret' }), /credential marker/)
  assert.throws(() => assertEvidenceSafe({ value: 'top-secret' }, ['top-secret']), /secret value/)
  assert.throws(() => assertEvidenceSafe({ value: 'Authorization' }), /sensitive header/)
})

test('workflow is manual, production-protected, main-only, source-locked, cleanup-capable, and redaction-scanned', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/chat11-bounded-write-production-smoke.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s+push:/m)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /pull-requests: write/)
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/)
  assert.match(workflow, /--expected-sha "\$GITHUB_SHA"/)
  assert.match(workflow, /chat11-bounded-write-production-smoke\.mjs/)
  assert.match(workflow, /Scan immutable evidence for secret leaks[\s\S]*if: always\(\)/)
  assert.match(workflow, /Upload redacted immutable evidence[\s\S]*if: always\(\)/)
  assert.match(workflow, /old_agent_branches_touched/)
})
