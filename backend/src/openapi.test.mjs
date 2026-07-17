import assert from 'node:assert/strict'
import test from 'node:test'
import { openapiSpec } from './openapi.ts'

test('OpenAPI schema exposes safe deployment actions', () => {
  const spec = openapiSpec('https://bestcode.example')

  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.info.version, '0.7.0')
  assert.equal(spec.servers[0].url, 'https://bestcode.example')
  assert.ok(spec.components.schemas && typeof spec.components.schemas === 'object')

  const start = spec.paths['/api/actions/deployment_start']?.post
  const status = spec.paths['/api/actions/deployment_status']?.post
  const logs = spec.paths['/api/actions/deployment_logs']?.post

  assert.equal(start.operationId, 'deployment_start')
  assert.equal(status.operationId, 'deployment_status')
  assert.equal(logs.operationId, 'deployment_logs')
  assert.deepEqual(start.requestBody.content['application/json'].schema.required, ['project_id'])
  assert.deepEqual(
    start.requestBody.content['application/json'].schema.properties.target.enum,
    ['backend', 'frontend', 'all'],
  )
  assert.match(start.description, /first call creates a separate high-risk approval/i)
})

test('OpenAPI operation IDs remain unique', () => {
  const spec = openapiSpec('https://bestcode.example')
  const operationIds = Object.values(spec.paths).map((path) => path.post.operationId)
  assert.equal(new Set(operationIds).size, operationIds.length)
})
