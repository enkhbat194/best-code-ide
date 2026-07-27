import assert from 'node:assert/strict'
import test from 'node:test'

import { unauthorizedResponse } from './authenticationResponse.ts'

test('returns the exact authentication denial code in the 401 response body', async () => {
  const response = unauthorizedResponse('INVALID_BOUNDED_WRITE_CREDENTIAL')
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer realm="BestCode MCP"')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INVALID_BOUNDED_WRITE_CREDENTIAL',
      message: 'Unauthorized — missing or invalid Bearer token',
    },
  })
})

test('uses a safe default denial code', async () => {
  const response = unauthorizedResponse()
  assert.equal((await response.json()).error.code, 'AUTHENTICATION_REQUIRED')
})
