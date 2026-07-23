#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TRANSIENT_IN_PROGRESS_CODES = new Set([
  'BC-R23-BUILD-NOT-SUCCESS',
  'BC-R23-ACTIVE-SHA-MISMATCH',
])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function violationCodes(release) {
  return Array.isArray(release?.violations)
    ? release.violations.map((item) => item?.code).filter(Boolean)
    : []
}

export function isTransientCloudflareDeployLag(evidence) {
  if (!isObject(evidence) || evidence.execution?.conclusion !== 'failure') return false
  if (!Array.isArray(evidence.workers) || evidence.workers.length === 0) return false

  const branch = evidence.scope?.branch
  return evidence.workers.every((worker) => {
    if (worker?.trigger_policy?.ok !== true) return false
    const release = worker?.release
    if (release?.ok === true) return true
    if (release?.retryable === true && ['stale_main', 'unverified'].includes(release?.state)) return true

    const build = release?.active_build
    const codes = violationCodes(release)
    return release?.state === 'source_mismatch'
      && isObject(build)
      && !build.outcome
      && build.branch === branch
      && build.deploy_mode === 'production_deploy'
      && codes.length > 0
      && codes.every((code) => TRANSIENT_IN_PROGRESS_CODES.has(code))
  })
}

function numericArg(value, name, minimum = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${name} must be at least ${minimum}`)
  return parsed
}

function parseWrapperArgs(argv) {
  const separator = argv.indexOf('--')
  if (separator < 0) throw new Error('Use -- before cloudflare-release-integrity.mjs arguments')
  const wrapperArgs = argv.slice(0, separator)
  const childArgs = argv.slice(separator + 1)
  const parsed = {}
  for (let index = 0; index < wrapperArgs.length; index += 2) {
    const key = wrapperArgs[index]
    const value = wrapperArgs[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid wrapper argument: ${key ?? ''}`)
    parsed[key.slice(2)] = value
  }
  const outputIndex = childArgs.indexOf('--output')
  if (outputIndex < 0 || !childArgs[outputIndex + 1]) throw new Error('Child arguments require --output')
  return {
    maxWaitSeconds: numericArg(parsed['max-wait-seconds'] ?? '900', '--max-wait-seconds'),
    retryPollSeconds: numericArg(parsed['retry-poll-seconds'] ?? '20', '--retry-poll-seconds'),
    outputPath: resolve(process.cwd(), childArgs[outputIndex + 1]),
    childArgs,
  }
}

function runChild(scriptPath, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: 'inherit' })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (signal) return resolvePromise(1)
      return resolvePromise(code ?? 1)
    })
  })
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export async function runReleaseIntegrityWithRetry(options) {
  const deadline = Date.now() + options.maxWaitSeconds * 1000
  let attempt = 0
  while (true) {
    attempt += 1
    const exitCode = await (options.runChildImpl ?? runChild)(options.scriptPath, options.childArgs)
    if (exitCode === 0) return { exitCode: 0, attempts: attempt }

    let evidence
    try {
      evidence = JSON.parse(await readFile(options.outputPath, 'utf8'))
    } catch {
      return { exitCode, attempts: attempt }
    }

    if (!isTransientCloudflareDeployLag(evidence) || Date.now() >= deadline) {
      return { exitCode, attempts: attempt }
    }
    await (options.sleepImpl ?? sleep)(options.retryPollSeconds * 1000)
  }
}

async function main() {
  const parsed = parseWrapperArgs(process.argv.slice(2))
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'cloudflare-release-integrity.mjs')
  const result = await runReleaseIntegrityWithRetry({ ...parsed, scriptPath })
  process.exitCode = result.exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
