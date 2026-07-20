import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MAX_REQUEST_BYTES,
  enforceRequestLimits,
  parsePositiveInteger,
  redactSensitive,
  redactText,
} from './security.ts'

test('request limit rejects oversized mutation bodies', async () => {
  const request = new Request('https://bestcode.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Length': String(DEFAULT_MAX_REQUEST_BYTES + 1) },
  })
  const response = enforceRequestLimits(request)
  assert.equal(response?.status, 413)
  assert.match((await response.json()).error, /exceeds/)
})

test('request limit allows reads and bounded bodies', () => {
  assert.equal(enforceRequestLimits(new Request('https://bestcode.test/health')), null)
  const request = new Request('https://bestcode.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Length': '1024' },
  })
  assert.equal(enforceRequestLimits(request), null)
})

test('request limit rejects invalid content length', async () => {
  const request = new Request('https://bestcode.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Length': '-1' },
  })
  const response = enforceRequestLimits(request)
  assert.equal(response?.status, 400)
})

test('redaction removes bearer, query, provider and keyed secrets', () => {
  const text = redactText('Bearer abc.def?x=1&key=owner-secret ghp_abcdefghijklmnopqrstuvwxyz')
  assert.equal(text.includes('owner-secret'), false)
  assert.equal(text.includes('ghp_'), false)
  assert.match(text, /Bearer \[REDACTED\]/)

  const payload = redactSensitive({
    authorization: 'Bearer hidden',
    nested: { api_key: 'secret', message: 'token=plain&access_token=hidden' },
  })
  assert.deepEqual(payload, {
    authorization: '[REDACTED]',
    nested: { api_key: '[REDACTED]', message: 'token=plain&access_token=[REDACTED]' },
  })
})

test('positive integer config falls back safely', () => {
  assert.equal(parsePositiveInteger('2048', 10), 2048)
  assert.equal(parsePositiveInteger('0', 10), 10)
  assert.equal(parsePositiveInteger('not-a-number', 10), 10)
})
