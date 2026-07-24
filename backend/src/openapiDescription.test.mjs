import assert from 'node:assert/strict'
import test from 'node:test'

import { deliveryMcpTools } from './mcpDeliveryTools.ts'
import { deploymentMcpTools } from './mcpDeploymentTools.ts'
import { readOnlyMcpTools } from './mcpReadTools.ts'
import { rollbackMcpTools } from './mcpRollbackTools.ts'
import { safeWriteMcpTools } from './mcpWriteTools.ts'
import { missionMcpTools } from './missionTools.ts'
import { missionExecutionMcpTools } from './missionExecutionTools.ts'
import { openapiSpec } from './openapi.ts'
import { ACTION_DESCRIPTION_LIMIT, buildActionDescription } from './openapiDescription.ts'
import { projectBrainMcpTools } from './projectBrainTools.ts'

function generatedOperations() {
  const spec = openapiSpec('https://bestcode.test')
  return Object.values(spec.paths).map((path) => path.post)
}

test('action descriptions are normalized and bounded below the GPT limit', () => {
  assert.equal(ACTION_DESCRIPTION_LIMIT, 280)

  const result = buildActionDescription(
    '  A long\n\tdescription  '.repeat(40),
    '  This action follows approval rules.  ',
  )

  assert.ok(Array.from(result).length <= ACTION_DESCRIPTION_LIMIT)
  assert.ok(result.endsWith('â€¦'))
  assert.doesNotMatch(result, /\s{2,}/u)
})

test('description truncation does not split a Unicode code point', () => {
  const result = buildActionDescription('AðŸ˜€BC', '', 3)

  assert.equal(result, 'AðŸ˜€â€¦')
  assert.equal(Array.from(result).length, 3)
  assert.deepEqual(Array.from(result), ['A', 'ðŸ˜€', 'â€¦'])
})

test('every generated OpenAPI action uses a bounded description', () => {
  const expectedNames = [
    ...readOnlyMcpTools,
    ...safeWriteMcpTools,
    ...deliveryMcpTools,
    ...deploymentMcpTools,
    ...rollbackMcpTools,
    ...projectBrainMcpTools,
    ...missionMcpTools,
    ...missionExecutionMcpTools,
  ].map((tool) => tool.name)
  const operations = generatedOperations()

  assert.equal(operations.length, expectedNames.length)
  assert.deepEqual(
    operations.map((operation) => operation.operationId).sort(),
    expectedNames.sort(),
  )
  for (const operation of operations) {
    assert.equal(typeof operation.description, 'string')
    assert.ok(operation.description.length > 0, operation.operationId)
    assert.ok(
      Array.from(operation.description).length <= ACTION_DESCRIPTION_LIMIT,
      `${operation.operationId}: ${operation.description}`,
    )
    assert.doesNotMatch(operation.description, /\s{2,}/u)
  }
})

test('invalid limits fail closed', () => {
  assert.throws(() => buildActionDescription('x', 'y', 0), RangeError)
  assert.throws(() => buildActionDescription('x', 'y', 1.5), RangeError)
})

