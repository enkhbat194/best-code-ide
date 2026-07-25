#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : fallback
}

function requiredRef(value, name) {
  const ref = String(value ?? '').trim()
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref) || ref.includes('..')) {
    throw new Error(`${name} is invalid`)
  }
  return ref
}

function run(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function addedLines(diff) {
  const lines = []
  let path = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice(6)
      continue
    }
    if (!path || !line.startsWith('+') || line.startsWith('+++')) continue
    lines.push({ path, value: line.slice(1) })
  }
  return lines
}

const base = requiredRef(argument('base'), 'base')
const head = requiredRef(argument('head'), 'head')
const output = resolve(argument('output', 'artifacts/chat11-pr-security-audit.json'))
const range = `${base}...${head}`

let diffCheck = 'passed'
try {
  run(['diff', '--check', range])
} catch (error) {
  diffCheck = String(error?.stdout || error?.stderr || error?.message || error).slice(0, 4000)
}

const changedFiles = run(['diff', '--name-only', '--diff-filter=ACMR', range])
  .split('\n')
  .map((item) => item.trim())
  .filter(Boolean)
const diff = run(['diff', '--no-ext-diff', '--no-color', '--unified=0', range, '--', ...changedFiles])
const candidates = addedLines(diff).filter(({ path }) =>
  !/(^|\/)(?:fixtures?|snapshots?)(\/|$)/i.test(path) &&
  !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path))

const patterns = [
  ['bounded_write_credential', /bcwrite_v1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=?\b/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
]
const findings = []
for (const candidate of candidates) {
  for (const [kind, pattern] of patterns) {
    if (pattern.test(candidate.value)) {
      findings.push({ path: candidate.path, kind, line_sha256: sha256(candidate.value) })
    }
  }
}

const protectedWorkflow = changedFiles.includes('.github/workflows/chat11-bounded-write-production-smoke.yml')
const report = {
  schema_version: 1,
  type: 'chat11_pr_security_audit',
  range,
  base,
  head,
  diff_check: diffCheck === 'passed' ? 'passed' : 'failed',
  diff_check_output: diffCheck === 'passed' ? [] : diffCheck.split('\n').filter(Boolean).slice(0, 100),
  changed_file_count: changedFiles.length,
  changed_files: changedFiles,
  protected_workflow_changed: protectedWorkflow,
  scanned_added_line_count: candidates.length,
  secret_findings: findings,
  conclusion: diffCheck === 'passed' && findings.length === 0 ? 'success' : 'failure',
}
report.digest = `sha256:${sha256(JSON.stringify(report))}`

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
console.log(`Chat 11 PR security audit: ${report.conclusion}`)
console.log(`Changed files: ${changedFiles.length}`)
console.log(`Secret findings: ${findings.length}`)
if (report.conclusion !== 'success') {
  if (diffCheck !== 'passed') console.error(diffCheck)
  process.exitCode = 1
}
