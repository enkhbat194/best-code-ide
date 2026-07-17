import assert from 'node:assert/strict'
import test from 'node:test'
import { applyUnifiedPatch, createUnifiedDiff } from './patch.ts'

test('applies a valid single-file unified patch', () => {
  const original = ['alpha', 'beta', 'gamma', 'delta'].join('\n')
  const patch = [
    '--- a/src/example.txt',
    '+++ b/src/example.txt',
    '@@ -1,4 +1,5 @@',
    ' alpha',
    '-beta',
    '+BETA',
    '+inserted',
    ' gamma',
    ' delta',
  ].join('\n')

  const result = applyUnifiedPatch(original, patch, 'src/example.txt')
  assert.equal(result.content, ['alpha', 'BETA', 'inserted', 'gamma', 'delta'].join('\n'))
  assert.equal(result.oldLineCount, 4)
  assert.equal(result.newLineCount, 5)
})

test('rejects a patch when source context changed', () => {
  const original = ['alpha', 'changed', 'gamma'].join('\n')
  const patch = [
    '--- a/src/example.txt',
    '+++ b/src/example.txt',
    '@@ -1,3 +1,3 @@',
    ' alpha',
    '-beta',
    '+BETA',
    ' gamma',
  ].join('\n')

  assert.throws(
    () => applyUnifiedPatch(original, patch, 'src/example.txt'),
    /deletion mismatch at source line 2/,
  )
})

test('rejects a patch for another path', () => {
  const patch = [
    '--- a/src/wrong.txt',
    '+++ b/src/wrong.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n')

  assert.throws(() => applyUnifiedPatch('old', patch, 'src/right.txt'), /does not match requested path/)
})

test('creates a bounded update diff that can be applied back', () => {
  const before = ['one', 'two', 'three', 'four', 'five'].join('\n')
  const after = ['one', 'two', 'THREE', 'new', 'four', 'five'].join('\n')
  const diff = createUnifiedDiff('src/example.txt', before, after)

  assert.match(diff, /^--- a\/src\/example\.txt/m)
  assert.match(diff, /^\+\+\+ b\/src\/example\.txt/m)
  assert.equal(applyUnifiedPatch(before, diff, 'src/example.txt').content, after)
})

test('creates explicit new-file and deletion headers', () => {
  const createDiff = createUnifiedDiff('src/new.txt', null, 'hello')
  const deleteDiff = createUnifiedDiff('src/old.txt', 'goodbye', null)

  assert.match(createDiff, /^--- \/dev\/null/m)
  assert.match(createDiff, /^\+\+\+ b\/src\/new\.txt/m)
  assert.match(deleteDiff, /^--- a\/src\/old\.txt/m)
  assert.match(deleteDiff, /^\+\+\+ \/dev\/null/m)
})
