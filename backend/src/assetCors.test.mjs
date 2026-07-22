import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CORS_HEADERS, withCors } from './utils.ts'

const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
const assetClientSource = await readFile(
  new URL('../../frontend/src/lib/assetClient.ts', import.meta.url),
  'utf8',
)

test('CORS contract supports authenticated Asset metadata, binary, and HEAD requests', () => {
  const headers = new Headers(CORS_HEADERS)
  assert.equal(headers.get('Access-Control-Allow-Origin'), '*')
  assert.match(headers.get('Access-Control-Allow-Methods') ?? '', /\bPUT\b/)
  assert.match(headers.get('Access-Control-Allow-Methods') ?? '', /\bDELETE\b/)
  assert.match(headers.get('Access-Control-Allow-Methods') ?? '', /\bHEAD\b/)
  assert.match(headers.get('Access-Control-Allow-Headers') ?? '', /Authorization/)
  assert.match(headers.get('Access-Control-Expose-Headers') ?? '', /Content-Disposition/)
})

test('withCors preserves private Asset response metadata while exposing it to the PWA', async () => {
  const response = withCors(new Response(JSON.stringify({ stored: true }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }))

  assert.equal(response.status, 201)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.deepEqual(await response.json(), { stored: true })
})

test('authenticated Brain metadata and Asset binary routes add CORS to actual responses', () => {
  assert.match(indexSource, /return withCors\(assetBinaryResponse\)/)
  assert.match(indexSource, /return withCors\(brainResponse\)/)
  assert.ok(indexSource.indexOf('handleAssetBinaryApi') < indexSource.indexOf('return withCors(assetBinaryResponse)'))
  assert.ok(indexSource.indexOf('handleBrainApi') < indexSource.indexOf('return withCors(brainResponse)'))
})

test('Safari fetch and XHR network failures are translated instead of showing raw Load failed', () => {
  assert.match(assetClientSource, /Backend-тэй холбогдож чадсангүй/)
  assert.match(assetClientSource, /Сүлжээ эсвэл app origin алдааны улмаас upload/)
  assert.doesNotMatch(assetClientSource, /throw new Error\(cause instanceof Error \? cause\.message/)
})
