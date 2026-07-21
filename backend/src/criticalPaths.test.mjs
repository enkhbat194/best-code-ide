import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyCriticalPath,
  classifyCriticalPaths,
  criticalPathPolicyError,
} from './criticalPaths.ts'

test('classifies canonical source and decision paths as critical', () => {
  assert.deepEqual(classifyCriticalPath('BESTCODE_MASTER.md'), {
    path: 'BESTCODE_MASTER.md',
    class: 'canonical_source',
    critical: true,
    rule_id: 'BC-R31',
    reason: 'Canonical Master, roadmap, architecture, status, or accepted decision source',
  })
  assert.equal(classifyCriticalPath('docs/DECISIONS/BC-036-canonical-roadmap-lock.md').rule_id, 'BC-R31')
})

test('classifies security, workflow, deployment, and dependency controls', () => {
  assert.equal(classifyCriticalPath('backend/src/security.ts').rule_id, 'BC-R32')
  assert.equal(classifyCriticalPath('.github/workflows/deploy.yml').rule_id, 'BC-R33')
  assert.equal(classifyCriticalPath('backend/wrangler.toml').rule_id, 'BC-R34')
  assert.equal(classifyCriticalPath('frontend/package-lock.json').rule_id, 'BC-R35')
  assert.equal(classifyCriticalPath('frontend/vite.config.ts').rule_id, 'BC-R35')
})

test('ordinary application files remain non-critical', () => {
  const finding = classifyCriticalPath('./frontend/src/components/Card.tsx')
  assert.equal(finding.critical, false)
  assert.equal(finding.rule_id, 'BC-R30')
})

test('batch classifier normalizes and deduplicates paths', () => {
  const findings = classifyCriticalPaths([
    './backend/src/security.ts',
    'backend\\src\\security.ts',
    'frontend/src/App.tsx',
  ])
  assert.equal(findings.length, 2)
  assert.equal(findings.filter((item) => item.critical).length, 1)
})

test('policy error names exact rules and paths', () => {
  const error = criticalPathPolicyError(classifyCriticalPaths([
    'docs/ROADMAP.md',
    '.github/workflows/deploy.yml',
  ]))
  assert.match(error ?? '', /BC-R31/)
  assert.match(error ?? '', /BC-R33/)
  assert.match(error ?? '', /docs\/ROADMAP\.md/)
  assert.equal(criticalPathPolicyError(classifyCriticalPaths(['frontend/src/App.tsx'])), null)
})
