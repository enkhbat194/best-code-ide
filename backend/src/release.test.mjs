import assert from 'node:assert/strict'
import test from 'node:test'

import { assessReleaseIntegrity, healthPayload, PRODUCTION_BRANCH } from './release.ts'

test('production branch policy remains pinned to main', () => {
  assert.equal(PRODUCTION_BRANCH, 'main')
})

test('release integrity verifies only the exact default-branch SHA', () => {
  assert.deepEqual(
    assessReleaseIntegrity({
      clientBranch: 'main',
      clientSha: 'a'.repeat(40),
      defaultBranch: 'main',
      mainSha: 'a'.repeat(40),
    }),
    {
      status: 'verified_main',
      production_ready: true,
      reason: 'PWA branch ба SHA нь GitHub main-ийн одоогийн source-той таарч байна.',
    },
  )
})

test('release integrity identifies preview, stale, and unverified builds', () => {
  assert.equal(
    assessReleaseIntegrity({
      clientBranch: 'agent/release-ui',
      clientSha: 'a'.repeat(40),
      defaultBranch: 'main',
      mainSha: 'a'.repeat(40),
    }).status,
    'preview_build',
  )
  assert.equal(
    assessReleaseIntegrity({
      clientBranch: 'refs/heads/main',
      clientSha: 'a'.repeat(40),
      defaultBranch: 'main',
      mainSha: 'b'.repeat(40),
    }).status,
    'stale_main',
  )
  assert.equal(
    assessReleaseIntegrity({
      clientBranch: 'local',
      clientSha: 'unknown',
      defaultBranch: 'main',
      mainSha: 'b'.repeat(40),
    }).status,
    'unverified',
  )
})

test('health payload exposes bounded Worker version metadata', () => {
  assert.deepEqual(
    healthPayload({
      CF_VERSION_METADATA: {
        id: 'version-id',
        tag: 'release-tag',
        timestamp: '2026-07-19T00:00:00.000Z',
      },
    }),
    {
      ok: true,
      build: 'master-v2-integrity-v1',
      worker_version: {
        id: 'version-id',
        tag: 'release-tag',
        created_at: '2026-07-19T00:00:00.000Z',
      },
    },
  )
})
