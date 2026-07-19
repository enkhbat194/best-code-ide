import type { Env } from './types'

export interface ProjectConfig {
  id: string
  name: string
  owner: string
  repo: string
  defaultBranch: string
  description?: string
  buildWorkflow?: string
  testWorkflow?: string
  deployWorkflow?: string
  previewUrl?: string
  memoryPaths?: string[]
}

const DEFAULT_PROJECTS: ProjectConfig[] = [
  {
    id: 'bestcode',
    name: 'BestCode PWA',
    owner: 'enkhbat194',
    repo: 'best-code-ide',
    defaultBranch: 'main',
    description: 'Private mobile-first Personal Creation OS and governed AI project controller.',
    buildWorkflow: 'validate.yml',
    testWorkflow: 'test.yml',
    deployWorkflow: 'deploy.yml',
    memoryPaths: [
      'BESTCODE_MASTER.md',
      'docs/PROJECT_STATUS.md',
      'docs/ARCHITECTURE.md',
      'docs/ROADMAP.md',
      'docs/RESEARCH_POLICY.md',
      'docs/EVIDENCE_STANDARD.md',
      'docs/THREAT_MODEL.md',
      'docs/PRODUCT_BENCHMARK.md',
      'docs/DECISIONS/README.md',
      'docs/DECISIONS/0001-project-brain-and-ai-roles.md',
      'docs/DECISIONS/0002-personal-creation-os.md',
      'README.md',
    ],
  },
]

function optionalString(project: Record<string, unknown>, key: string): boolean {
  return project[key] === undefined || typeof project[key] === 'string'
}

function optionalStringArray(project: Record<string, unknown>, key: string): boolean {
  return project[key] === undefined || (
    Array.isArray(project[key]) &&
    (project[key] as unknown[]).length <= 20 &&
    (project[key] as unknown[]).every((item) => typeof item === 'string' && item.trim().length > 0)
  )
}

function isProject(value: unknown): value is ProjectConfig {
  if (!value || typeof value !== 'object') return false
  const project = value as Record<string, unknown>
  return (
    typeof project.id === 'string' &&
    /^[a-zA-Z0-9._-]{1,64}$/.test(project.id) &&
    typeof project.name === 'string' &&
    typeof project.owner === 'string' &&
    typeof project.repo === 'string' &&
    typeof project.defaultBranch === 'string' &&
    optionalString(project, 'description') &&
    optionalString(project, 'buildWorkflow') &&
    optionalString(project, 'testWorkflow') &&
    optionalString(project, 'deployWorkflow') &&
    optionalString(project, 'previewUrl') &&
    optionalStringArray(project, 'memoryPaths')
  )
}

export function listProjects(env: Env): ProjectConfig[] {
  const raw = env.PROJECTS_JSON?.trim()
  if (!raw) return DEFAULT_PROJECTS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('PROJECTS_JSON is not valid JSON')
  }

  if (!Array.isArray(parsed) || !parsed.every(isProject)) {
    throw new Error('PROJECTS_JSON must be an array of valid project objects')
  }

  const ids = new Set<string>()
  for (const project of parsed) {
    if (ids.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`)
    ids.add(project.id)
  }

  return parsed
}

export function getProject(env: Env, projectId: string): ProjectConfig {
  const project = listProjects(env).find((item) => item.id === projectId)
  if (!project) throw new Error(`Project not found or not permitted: ${projectId}`)
  return project
}
