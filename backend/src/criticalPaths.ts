import type { ApprovalOperation, RiskLevel } from './approvalStore'

export type CriticalPathClass =
  | 'canonical_source'
  | 'security_auth'
  | 'workflow_release'
  | 'deploy_runtime'
  | 'dependency_control'
  | 'ordinary'

export interface CriticalPathFinding {
  path: string
  class: CriticalPathClass
  critical: boolean
  rule_id: string
  reason: string
}

const CANONICAL_EXACT = new Set([
  'BESTCODE_MASTER.md',
  'docs/ROADMAP.md',
  'docs/PROJECT_STATUS.md',
  'docs/ARCHITECTURE.md',
])

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.json',
  'deno.lock',
  'wrangler.toml',
])

function normalize(path: string): string {
  return path.trim().replace(/^\.\//, '').replace(/\\/g, '/')
}

export function classifyCriticalPath(inputPath: string): CriticalPathFinding {
  const path = normalize(inputPath)
  const lower = path.toLowerCase()
  const basename = lower.split('/').at(-1) ?? lower

  if (CANONICAL_EXACT.has(path) || lower.startsWith('docs/decisions/')) {
    return {
      path,
      class: 'canonical_source',
      critical: true,
      rule_id: 'BC-R31',
      reason: 'Canonical Master, roadmap, architecture, status, or accepted decision source',
    }
  }

  if (
    lower.startsWith('backend/src/security') ||
    lower.startsWith('backend/src/auth') ||
    lower.includes('/security/') ||
    lower.includes('/auth/') ||
    lower.endsWith('/types.ts') && lower.startsWith('backend/src/')
  ) {
    return {
      path,
      class: 'security_auth',
      critical: true,
      rule_id: 'BC-R32',
      reason: 'Authentication, authorization, credential handling, or security policy path',
    }
  }

  if (lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/')) {
    return {
      path,
      class: 'workflow_release',
      critical: true,
      rule_id: 'BC-R33',
      reason: 'CI, release, deployment, rollback, or repository automation workflow',
    }
  }

  if (
    lower === 'backend/wrangler.toml' ||
    lower === 'frontend/wrangler.toml' ||
    lower.startsWith('deploy/') ||
    lower.includes('/deploy/') ||
    lower.includes('rollback') ||
    lower.includes('release')
  ) {
    return {
      path,
      class: 'deploy_runtime',
      critical: true,
      rule_id: 'BC-R34',
      reason: 'Production deployment, runtime binding, release, or rollback control path',
    }
  }

  if (DEPENDENCY_FILES.has(basename) || lower.endsWith('/tsconfig.json') || lower.endsWith('/vite.config.ts')) {
    return {
      path,
      class: 'dependency_control',
      critical: true,
      rule_id: 'BC-R35',
      reason: 'Dependency lock, package manifest, compiler, build, or runtime configuration',
    }
  }

  return {
    path,
    class: 'ordinary',
    critical: false,
    rule_id: 'BC-R30',
    reason: 'No critical-path rule matched',
  }
}

export function classifyCriticalPaths(paths: string[]): CriticalPathFinding[] {
  return [...new Set(paths.map(normalize).filter(Boolean))].map(classifyCriticalPath)
}

export function criticalPathPolicyError(findings: CriticalPathFinding[]): string | null {
  const critical = findings.filter((finding) => finding.critical)
  if (critical.length === 0) return null
  const rules = [...new Set(critical.map((finding) => finding.rule_id))].join(', ')
  const paths = critical.map((finding) => finding.path).join(', ')
  return `${rules}: critical-path change requires explicit core/critical review: ${paths}`
}

function criticalRiskReasons(findings: CriticalPathFinding[]): string[] {
  const critical = findings.filter((finding) => finding.critical)
  const reasons: string[] = []
  for (const finding of critical) {
    reasons.push(`critical_path:${finding.rule_id}`)
    reasons.push(`critical_path_file:${finding.path}`)
  }
  return [...new Set(reasons)]
}

export function applyCriticalPathRisk<T extends Pick<ApprovalOperation, 'changes' | 'risk' | 'risk_reasons'>>(
  operation: T,
): T & { risk: RiskLevel; risk_reasons: string[] } {
  const findings = classifyCriticalPaths(operation.changes.map((change) => change.path))
  const reasons = [...new Set([...operation.risk_reasons, ...criticalRiskReasons(findings)])]
  const critical = findings.some((finding) => finding.critical)
  operation.risk = critical ? 'high' : operation.risk
  operation.risk_reasons = reasons
  return operation as T & { risk: RiskLevel; risk_reasons: string[] }
}
