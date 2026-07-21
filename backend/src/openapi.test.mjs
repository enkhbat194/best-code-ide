import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { deploymentMcpTools } from './mcpDeploymentTools.ts'
import { openapiSpec } from './openapi.ts'

const deploymentSource = readFileSync(new URL('./mcpDeploymentTools.ts', import.meta.url), 'utf8')

test('generated OpenAPI preserves version, schemas, and bearer authentication', () => {
  const spec = openapiSpec('https://bestcode.test')

  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.info.version, '0.11.0')
  assert.deepEqual(spec.security, [{ bearerAuth: [] }])
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'BestCode AUTH_TOKEN',
  })
  assert.ok(spec.components.schemas.ToolEnvelope)
  assert.ok(spec.components.schemas.ToolError)
  assert.ok(spec.components.schemas.HttpError)

  const operations = Object.values(spec.paths).map((path) => path.post)
  assert.ok(operations.length > 0)
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, operations.length)
  assert.equal(operations.some((operation) => operation.operationId === 'approval_decide'), false)
  for (const operation of operations) {
    assert.deepEqual(operation.security, [{ bearerAuth: [] }])
    assert.equal(
      operation.responses['200'].content['application/json'].schema.$ref,
      '#/components/schemas/ToolEnvelope',
    )
  }
})

test('Project Brain tools share one tagged Actions surface', () => {
  const spec = openapiSpec('https://bestcode.test')
  const names = [
    'project_context_get',
    'project_memory_search',
    'project_task_start',
    'project_task_list',
    'project_task_get',
    'project_task_update',
    'project_handoff_record',
    'project_handoff_list',
  ]

  for (const name of names) {
    const operation = spec.paths[`/api/actions/${name}`].post
    assert.equal(operation.operationId, name)
    assert.deepEqual(operation.tags, ['Project Brain'])
  }
})

test('Mission tools share one tagged Actions surface', () => {
  const spec = openapiSpec('https://bestcode.test')
  for (const name of ['mission_create', 'mission_get', 'mission_list', 'mission_transition', 'mission_lease', 'mission_mutate', 'mission_context_packet']) {
    const operation = spec.paths[`/api/actions/${name}`].post
    assert.equal(operation.operationId, name)
    assert.deepEqual(operation.tags, ['Missions'])
  }
})

test('deployment tools remain explicit and unique in the generated schema', () => {
  const names = deploymentMcpTools.map((tool) => tool.name)
  assert.deepEqual(names, ['deployment_start', 'deployment_status', 'deployment_logs'])
  assert.equal(new Set(names).size, names.length)

  const spec = openapiSpec('https://bestcode.test')
  for (const name of names) {
    assert.equal(spec.paths[`/api/actions/${name}`].post.operationId, name)
    assert.deepEqual(spec.paths[`/api/actions/${name}`].post.tags, ['Deployment'])
  }
})

test('deployment start requires project and supports bounded targets', () => {
  const start = deploymentMcpTools.find((tool) => tool.name === 'deployment_start')
  assert.ok(start)
  assert.deepEqual(start.inputSchema.required, ['project_id'])
  assert.deepEqual(start.inputSchema.properties.target.enum, ['backend', 'frontend', 'all'])
  assert.match(deploymentSource, /Deployment branch must equal the project default branch/)
  assert.match(deploymentSource, /production_deployment/)
})
