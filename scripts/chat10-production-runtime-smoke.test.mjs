import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assertEvidenceSafe,
  buildSmokeFixtures,
  deterministicHash,
  runProductionRuntimeSmoke,
} from './chat10-production-runtime-smoke.mjs'

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('Chat 10 smoke fixtures are deterministic, isolated, and hard-dependency bounded', () => {
  const first = buildSmokeFixtures('workflow-123-attempt-1')
  const second = buildSmokeFixtures('workflow-123-attempt-1')
  assert.deepEqual(first, second)
  assert.match(first.projectId, /^chat10-smoke-/)
  assert.equal(first.plan.deterministic_hash, deterministicHash(first.plan))
  assert.equal(first.tasks.length, 5)
  assert.equal(first.tasks[0].dependencies.length, 0)
  assert.deepEqual(first.tasks[1].dependencies, [{ task_id: first.tasks[0].task_id, kind: 'hard' }])
  assert.ok(first.tasks.every((task) => task.project_id === first.projectId && task.mission_id === first.missionId))
  assert.ok(first.plan.safety_constraints.includes('no subscription credential mutation'))
})

test('failure evidence redacts the owner token and never persists request headers', async () => {
  const secret = 'chat10-owner-secret-sentinel'
  let requestCount = 0
  const evidence = await runProductionRuntimeSmoke({
    baseUrl: 'https://bestcode.test',
    token: secret,
    runKey: 'redaction-failure-1',
    fetchImpl: async (_url, init = {}) => {
      requestCount += 1
      assert.equal(init.headers.Authorization, `Bearer ${secret}`)
      return json(500, {
        error: `Authorization: Bearer ${secret}`,
      })
    },
  })

  const serialized = JSON.stringify(evidence)
  assert.equal(requestCount, 1)
  assert.equal(evidence.execution.conclusion, 'failure')
  assert.equal(evidence.execution.failure.stage, 'mission_create')
  assert.equal(evidence.security.token_value_persisted, false)
  assert.equal(evidence.security.auth_header_persisted, false)
  assert.doesNotMatch(serialized, new RegExp(secret))
  assert.doesNotMatch(serialized, /authorization/i)
  assert.doesNotMatch(serialized, /bearer\s/i)
  assert.doesNotThrow(() => assertEvidenceSafe(evidence, secret))
})

test('secret leak guard rejects token values, auth header names, and bearer markers', () => {
  assert.throws(
    () => assertEvidenceSafe({ value: 'top-secret-value' }, 'top-secret-value'),
    /authentication secret/,
  )
  assert.throws(
    () => assertEvidenceSafe({ header: 'Authorization' }, 'not-present'),
    /header name/,
  )
  assert.throws(
    () => assertEvidenceSafe({ marker: 'Bearer redacted' }, 'not-present'),
    /bearer credential/,
  )
})

test('production workflow is manual, environment-protected, source-locked, and redaction-scanned', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/chat10-production-runtime-smoke.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s+push:/m)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /BESTCODE_AUTH_TOKEN: \$\{\{ secrets\.BESTCODE_AUTH_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /secrets\.AUTH_TOKEN/)
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/)
  assert.match(workflow, /--expected-sha "\$GITHUB_SHA"/)
  assert.match(workflow, /Scan immutable evidence for authentication leaks[\s\S]*?if: always\(\)/)
  assert.match(workflow, /Upload redacted immutable evidence[\s\S]*?if: always\(\)/)
  assert.match(workflow, /subscription_mutation_profile_enabled/)
})
