import assert from 'node:assert/strict'
import test from 'node:test'

import { missionMcpTools } from './missionTools.ts'

const names = missionMcpTools.map((tool) => tool.name)

test('Mission MCP exposes the locked Phase 4A.3 tool set', () => {
  assert.deepEqual(names, [
    'mission_create',
    'mission_get',
    'mission_list',
    'mission_transition',
    'mission_lease',
    'mission_context_packet',
  ])
})

test('Mission reads are read-only and writes never claim destructive execution', () => {
  const reads = new Set(['mission_get', 'mission_list', 'mission_context_packet'])
  for (const tool of missionMcpTools) {
    assert.equal(tool.annotations.destructiveHint, false)
    assert.equal(tool.annotations.openWorldHint, false)
    assert.equal(tool.annotations.readOnlyHint, reads.has(tool.name))
  }
})

test('Mission tool descriptions remain within the Actions compatibility bound', () => {
  for (const tool of missionMcpTools) assert.ok(tool.description.length <= 280, `${tool.name} description is too long`)
})
