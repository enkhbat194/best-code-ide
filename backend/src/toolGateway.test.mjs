import assert from 'node:assert/strict'
import test from 'node:test'

import { gatewayContextFromRequest } from './toolGateway.ts'

function request(headers = {}) {
  return new Request('https://best-code.example/mcp/subscription?project_id=bestcode', {
    method: 'POST',
    headers,
  })
}

test('gateway timeout defaults to 30 seconds when the header is absent', () => {
  const context = gatewayContextFromRequest(request(), 'subscription-write-bounded', 'mcp')
  assert.equal(context.timeout_ms, 30_000)
})

test('gateway timeout defaults to 30 seconds when the header is blank or invalid', () => {
  assert.equal(
    gatewayContextFromRequest(request({ 'X-BestCode-Timeout-Ms': ' ' }), 'subscription-write-bounded', 'mcp').timeout_ms,
    30_000,
  )
  assert.equal(
    gatewayContextFromRequest(request({ 'X-BestCode-Timeout-Ms': 'not-a-number' }), 'subscription-write-bounded', 'mcp').timeout_ms,
    30_000,
  )
})

test('gateway timeout clamps explicit values to the supported range', () => {
  assert.equal(
    gatewayContextFromRequest(request({ 'X-BestCode-Timeout-Ms': '500' }), 'subscription-write-bounded', 'mcp').timeout_ms,
    1_000,
  )
  assert.equal(
    gatewayContextFromRequest(request({ 'X-BestCode-Timeout-Ms': '45000' }), 'subscription-write-bounded', 'mcp').timeout_ms,
    45_000,
  )
  assert.equal(
    gatewayContextFromRequest(request({ 'X-BestCode-Timeout-Ms': '300000' }), 'subscription-write-bounded', 'mcp').timeout_ms,
    120_000,
  )
})
