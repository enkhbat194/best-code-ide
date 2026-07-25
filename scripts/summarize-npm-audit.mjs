#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : fallback
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function json(path) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || value.error) {
    throw new Error(`Invalid npm audit report: ${path}`)
  }
  return value
}

function advisoryDetails(vulnerability) {
  return (Array.isArray(vulnerability?.via) ? vulnerability.via : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      source: item.source ?? null,
      name: item.name ?? null,
      title: item.title ?? null,
      url: item.url ?? null,
      severity: item.severity ?? null,
      vulnerable_range: item.range ?? null,
      cwe: Array.isArray(item.cwe) ? item.cwe : [],
      cvss: item.cvss ?? null,
    }))
}

function normalizePackage(name, full, production) {
  const fullEntry = full.vulnerabilities?.[name] ?? {}
  const productionEntry = production.vulnerabilities?.[name] ?? null
  return {
    package: name,
    severity: fullEntry.severity ?? 'unknown',
    direct: Boolean(fullEntry.isDirect),
    dependency_type: productionEntry ? 'production-reachable' : 'development-only',
    production_reachable: Boolean(productionEntry),
    vulnerable_range: fullEntry.range ?? null,
    affected_nodes: Array.isArray(fullEntry.nodes) ? fullEntry.nodes : [],
    effects: Array.isArray(fullEntry.effects) ? fullEntry.effects : [],
    fix_available: fullEntry.fixAvailable ?? false,
    advisories: advisoryDetails(fullEntry),
  }
}

function packageSummary(scope, full, production) {
  const names = Object.keys(full.vulnerabilities ?? {}).sort()
  return {
    scope,
    full_metadata: full.metadata ?? null,
    production_metadata: production.metadata ?? null,
    vulnerabilities: names.map((name) => normalizePackage(name, full, production)),
  }
}

const input = resolve(argument('input', 'artifacts'))
const output = resolve(argument('output', 'artifacts/dependency-audit-summary.json'))
const backendFull = await json(resolve(input, 'backend-audit-full.json'))
const backendProduction = await json(resolve(input, 'backend-audit-production.json'))
const frontendFull = await json(resolve(input, 'frontend-audit-full.json'))
const frontendProduction = await json(resolve(input, 'frontend-audit-production.json'))

const packages = [
  packageSummary('backend', backendFull, backendProduction),
  packageSummary('frontend', frontendFull, frontendProduction),
]
const vulnerabilities = packages.flatMap((item) =>
  item.vulnerabilities.map((vulnerability) => ({ scope: item.scope, ...vulnerability })))
const severityOrder = ['critical', 'high', 'moderate', 'low', 'info', 'unknown']
const counts = Object.fromEntries(severityOrder.map((severity) => [
  severity,
  vulnerabilities.filter((item) => item.severity === severity).length,
]))
const report = {
  schema_version: 1,
  type: 'bestcode_dependency_audit_summary',
  generated_at: new Date().toISOString(),
  counts,
  production_reachable_count: vulnerabilities.filter((item) => item.production_reachable).length,
  packages,
}
report.digest = `sha256:${sha256(JSON.stringify(report))}`

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
console.log(`Dependency audit summary: ${vulnerabilities.length} affected package records`)
console.log(`High: ${counts.high}; Critical: ${counts.critical}; production-reachable: ${report.production_reachable_count}`)
