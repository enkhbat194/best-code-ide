import assert from 'node:assert/strict'
import test from 'node:test'

import { missionMcpTools } from './missionTools.ts'
import { openapiSpec } from './openapi.ts'

const byName = new Map(missionMcpTools.map((tool) => [tool.name, tool]))

test('Mission mutation is exposed with bounded idempotent contract', () => {
  const tool = byName.get('mission_mutate')
  assert.ok(tool)
  assert.equal(tool.annotations.idempotentHint, true)
  assert.deepEqual(tool.inputSchema.properties.mutation.enum, [
    'add_goal',
    'add_criterion',
    'record_decision',
    'resolve_decision',
    'add_task',
    'update_task',
    'record_operation',
    'update_operation',
  ])
  for (const field of ['mission_id', 'expected_context_version', 'holder_id', 'lease_id', 'idempotency_key', 'operation_id', 'mutation', 'entity']) {
    assert.ok(tool.inputSchema.required.includes(field))
  }
})

test('OpenAPI Actions and MCP share every Mission operation name', () => {
  const spec = openapiSpec('https://bestcode.test')
  for (const tool of missionMcpTools) {
    const path = spec.paths[`/api/actions/${tool.name}`]
    assert.ok(path, `missing Actions path for ${tool.name}`)
    assert.equal(path.post.operationId, tool.name)
    assert.deepEqual(path.post.tags, ['Missions'])
    assert.ok(path.post.description.length <= 300)
  }
})

test('Mission read and mutation annotations remain correctly separated', () => {
  for (const name of ['mission_get', 'mission_list', 'mission_context_packet']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, true)
  }
  for (const name of ['mission_create', 'mission_transition', 'mission_lease', 'mission_mutate']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, false)
  }
})
