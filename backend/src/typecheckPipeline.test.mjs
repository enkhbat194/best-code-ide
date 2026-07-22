import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(new URL('../../scripts/run-backend-typecheck-with-log.sh', import.meta.url))
const workflowPath = fileURLToPath(new URL('../../.github/workflows/validate.yml', import.meta.url))

test('validate typecheck pipeline preserves npm failure and uploads its log', async (t) => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'bestcode-typecheck-pipeline-'))
  t.after(() => rm(workdir, { recursive: true, force: true }))

  const binDir = path.join(workdir, 'bin')
  await mkdir(binDir)
  const fakeNpm = path.join(binDir, 'npm')
  await writeFile(
    fakeNpm,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$FAKE_TYPECHECK_OUTPUT"\nexit "$FAKE_TYPECHECK_EXIT"\n',
  )
  await chmod(fakeNpm, 0o755)

  const result = spawnSync('bash', [scriptPath], {
    cwd: workdir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_TYPECHECK_OUTPUT: 'synthetic TypeScript failure',
      FAKE_TYPECHECK_EXIT: '23',
    },
  })

  assert.equal(result.signal, null)
  assert.equal(result.status, 23)
  assert.match(await readFile(path.join(workdir, 'typecheck.log'), 'utf8'), /synthetic TypeScript failure/)

  const workflow = await readFile(workflowPath, 'utf8')
  assert.match(
    workflow,
    /- name: Typecheck[\s\S]*?shell: bash[\s\S]*?run: bash \.\.\/scripts\/run-backend-typecheck-with-log\.sh/,
  )
  assert.match(
    workflow,
    /- name: Upload typecheck log[\s\S]*?if: always\(\)[\s\S]*?path: backend\/typecheck\.log/,
  )
  assert.doesNotMatch(workflow, /npm run typecheck 2>&1 \| tee typecheck\.log/)
})
