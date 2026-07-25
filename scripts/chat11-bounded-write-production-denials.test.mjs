import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  SUPPLEMENTAL_DENIAL_KEYS,
  runSupplementalProductionDenials,
  scenarioRunKey,
} from './chat11-bounded-write-production-denials.mjs'

const SHA = '554908b69fa855e2292a88357c67fc340e457370'

test('supplemental denial contract covers the missing production matrix', () => {
  assert.deepEqual(SUPPLEMENTAL_DENIAL_KEYS, [
    'wrong_task',
    'stale_lease',
    'expired_credential',
    'second_push',
  ])
  assert.equal(scenarioRunKey('run/123', 'stale lease'), 'run-123-stale-lease')
})

test('supplemental failure evidence redacts protected secrets', async () => {
  const ownerSecret = 'owner-secret-chat11-denial-sentinel'
  const githubSecret = 'github-secret-chat11-denial-sentinel'
  const evidence = await runSupplementalProductionDenials({
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
})

test('controller source proves explicit lease release and cleanup coverage', async () => {
  const source = await readFile(new URL('./chat11-bounded-write-production-denials.mjs', import.meta.url), 'utf8')
  for (const key of SUPPLEMENTAL_DENIAL_KEYS) assert.match(source, new RegExp(key))
  assert.match(source, /mission_task_lease_release/)
  assert.match(source, /supplemental_production_proof/)
  assert.match(source, /terminal_credential_status/)
  assert.match(source, /branch_deleted/)
  assert.match(source, /execution_cancelled/)
  assert.match(source, /mission_cancelled/)
})

test('protected workflow pins actions and uploads both immutable evidence files', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/chat11-bounded-write-production-smoke.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/)
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/)
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /chat11-bounded-write-production-denials\.mjs/)
  assert.match(workflow, /chat11-bounded-write-production-denials\.json/)
  assert.match(workflow, /sha256sum artifacts\/chat11-bounded-write-\*\.json/)
  assert.match(workflow, /if-no-files-found: error/)
})
