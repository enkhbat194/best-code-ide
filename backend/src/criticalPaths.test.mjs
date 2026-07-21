import assert from 'node:assert/strict'
import test from 'node:test'

import { applyCriticalPathRisk, classifyCriticalPath, classifyCriticalPaths, criticalPathPolicyError } from './criticalPaths.ts'

test('classifies all critical path classes', () => {
  assert.equal(classifyCriticalPath('BESTCODE_MASTER.md').rule_id, 'BC-R31')
  assert.equal(classifyCriticalPath('backend/src/security.ts').rule_id, 'BC-R32')
  assert.equal(classifyCriticalPath('.github/workflows/deploy.yml').rule_id, 'BC-R33')
  assert.equal(classifyCriticalPath('backend/wrangler.toml').rule_id, 'BC-R34')
  assert.equal(classifyCriticalPath('frontend/package-lock.json').rule_id, 'BC-R35')
  assert.equal(classifyCriticalPath('frontend/src/App.tsx').rule_id, 'BC-R30')
})

test('batch classifier normalizes and deduplicates', () => {
  const findings = classifyCriticalPaths(['./backend/src/security.ts', 'backend\\src\\security.ts', 'frontend/src/App.tsx'])
  assert.equal(findings.length, 2)
})

test('policy error includes exact rules and paths', () => {
  const message = criticalPathPolicyError(classifyCriticalPaths(['docs/ROADMAP.md', '.github/workflows/deploy.yml']))
  assert.match(message ?? '', /BC-R31/)
  assert.match(message ?? '', /BC-R33/)
  assert.match(message ?? '', /docs\/ROADMAP\.md/)
})

test('critical staged changes become high risk with exact reasons', () => {
  const operation = {
    risk: 'normal',
    risk_reasons: ['file_deletion'],
    changes: [{ path: 'frontend/src/App.tsx' }, { path: '.github/workflows/deploy.yml' }, { path: 'docs/ROADMAP.md' }],
  }
  applyCriticalPathRisk(operation)
  assert.equal(operation.risk, 'high')
  assert.deepEqual(operation.risk_reasons, [
    'file_deletion',
    'critical_path:BC-R33',
    'critical_path_file:.github/workflows/deploy.yml',
    'critical_path:BC-R31',
    'critical_path_file:docs/ROADMAP.md',
  ])
})

test('ordinary staged changes preserve risk', () => {
  const operation = { risk: 'normal', risk_reasons: [], changes: [{ path: 'frontend/src/App.tsx' }] }
  applyCriticalPathRisk(operation)
  assert.equal(operation.risk, 'normal')
  assert.deepEqual(operation.risk_reasons, [])
})
