import assert from 'node:assert/strict'
import test from 'node:test'
import { runProductionRuntimeSmoke } from '../../scripts/chat10-production-runtime-smoke.mjs'
import { ApprovalStore } from './approvalStore.ts'
import { handleMissionApi } from './missionApi.ts'
import { handleMissionExecutionApi } from './missionExecutionApi.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, value)
  }

  async list(options = {}) {
    const prefix = options.prefix ?? ''
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)))
  }

  async transaction(callback) {
    return callback(this)
  }
}

function testEnv() {
  const store = new ApprovalStore({ storage: new MemoryStorage() })
  const stub = { fetch: (input, init) => store.fetch(input instanceof Request ? input : new Request(input, init)) }
  return {
    APPROVALS: {
      idFromName(name) {
        return name
      },
      get() {
        return stub
      },
    },
  }
}

test('production controller round-trips the real Mission execution runtime and cleans up', async () => {
  const env = testEnv()
  const secret = 'owner-test-secret'
  const fetchImpl = async (input, init = {}) => {
    assert.equal(init.headers.Authorization, `Bearer ${secret}`)
    const url = new URL(input)
    const request = new Request(url, init)
    const missionResponse = await handleMissionApi(request, env, url)
    if (missionResponse) return missionResponse
    const executionResponse = await handleMissionExecutionApi(request, env, url)
    if (executionResponse) return executionResponse
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const evidence = await runProductionRuntimeSmoke({
    baseUrl: 'https://bestcode.test',
    token: secret,
    runKey: 'local-runtime-round-trip-1',
    fetchImpl,
  })

  assert.equal(evidence.execution.conclusion, 'success')
  assert.equal(evidence.scope.isolated_project, true)
  assert.equal(evidence.scope.production_business_data_accessed, false)
  assert.ok(Object.values(evidence.checks).every(Boolean))
  assert.ok(Object.values(evidence.denials).every((denial) => denial.denied))
  assert.equal(evidence.audit.all_completed, true)
  assert.deepEqual(
    new Set(evidence.audit.required_event_names),
    new Set(evidence.audit.event_names),
  )
  assert.equal(evidence.cleanup.execution_cancelled, true)
  assert.equal(evidence.cleanup.mission_cancelled, true)
  assert.equal(evidence.cleanup.mission_lifecycle, 'cancelled')
  assert.deepEqual(evidence.cleanup.errors, [])
  assert.equal(evidence.security.subscription_credential_created, false)
  assert.equal(evidence.security.subscription_mutation_profile_enabled, false)
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(secret))
})
