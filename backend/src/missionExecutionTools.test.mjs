import assert from 'node:assert/strict'
import test from 'node:test'
import {
  missionExecutionMcpTools,
  missionExecutionMutationTools,
  missionExecutionOwnerTools,
  missionExecutionReadTools,
} from './missionExecutionTools.ts'
import { gatewayTools } from './toolGateway.ts'

test('Mission execution publishes the complete provider-neutral operation contract', () => {
  assert.equal(missionExecutionReadTools.length, 7)
  assert.equal(missionExecutionMutationTools.length, 10)
  assert.equal(missionExecutionOwnerTools.length, 3)
  assert.equal(new Set(missionExecutionMcpTools.map((tool) => tool.name)).size, 20)
  assert.ok(missionExecutionReadTools.every((tool) => tool.annotations.readOnlyHint))
  assert.ok(missionExecutionMutationTools.every((tool) => !tool.annotations.readOnlyHint && !tool.annotations.destructiveHint))
  assert.ok(missionExecutionOwnerTools.every((tool) => tool.annotations.destructiveHint))
})

test('legacy owner MCP advertises execution contracts while subscription profile stays exact read-only v1', () => {
  const legacy = new Set(gatewayTools('legacy').map((tool) => tool.name))
  for (const tool of missionExecutionMcpTools) assert.ok(legacy.has(tool.name))
  const subscription = gatewayTools('subscription-readonly')
  assert.equal(subscription.length, 12)
  assert.ok(subscription.every((tool) => tool.annotations.readOnlyHint && tool._meta['bestcode/safetyClass'] === 'read-only'))
  assert.ok(subscription.every((tool) => !legacy.has('mission_task_result_submit') || tool.name !== 'mission_task_result_submit'))
})

