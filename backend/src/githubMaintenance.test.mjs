import assert from 'node:assert/strict'
import test from 'node:test'

import { mergedPullRequestMatches } from './githubMaintenance.ts'

test('matches only the exact current branch SHA from a merged pull request', () => {
  const merged = [{
    branch: 'agent/example',
    sha: 'abc123',
    number: 42,
    merged_at: '2026-07-21T00:00:00Z',
  }]

  assert.equal(mergedPullRequestMatches({ name: 'agent/example', sha: 'abc123' }, merged)?.number, 42)
  assert.equal(mergedPullRequestMatches({ name: 'agent/example', sha: 'changed' }, merged), undefined)
  assert.equal(mergedPullRequestMatches({ name: 'agent/other', sha: 'abc123' }, merged), undefined)
})
