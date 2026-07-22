export const BRAIN_SCHEMA_VERSION = 'brain-v2' as const

export type BrainObjectKind =
  | 'project'
  | 'mission'
  | 'source'
  | 'asset'
  | 'goal'
  | 'criterion'
  | 'task'
  | 'decision'
  | 'evidence'
  | 'agent_run'
  | 'memory'

export type BrainTruthStatus = 'raw' | 'interpreted' | 'proposed' | 'verified' | 'superseded'
export type BrainSensitivity = 'normal' | 'private' | 'secret_reference'
export type BrainRetention = 'transient' | 'project' | 'permanent' | 'until'

export interface BrainObject {
  schema: typeof BRAIN_SCHEMA_VERSION
  object_id: string
  project_id: string
  mission_id: string | null
  kind: BrainObjectKind
  title: string | null
  body: string | null
  attributes: Record<string, unknown>
  source_ids: string[]
  truth_status: BrainTruthStatus
  sensitivity: BrainSensitivity
  retention: BrainRetention
  expires_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  version: number
}

export interface BrainRelation {
  schema: typeof BRAIN_SCHEMA_VERSION
  relation_id: string
  project_id: string
  mission_id: string | null
  from_object_id: string
  to_object_id: string
  relation_type: string
  attributes: Record<string, unknown>
  created_by: string
  created_at: string
}

export interface BrainEvent {
  schema: typeof BRAIN_SCHEMA_VERSION
  event_id: string
  project_id: string
  mission_id: string | null
  object_id: string | null
  event_type: string
  actor_id: string
  summary: string
  details: Record<string, unknown>
  occurred_at: string
}

const OBJECT_KINDS = new Set<BrainObjectKind>([
  'project', 'mission', 'source', 'asset', 'goal', 'criterion', 'task', 'decision', 'evidence', 'agent_run', 'memory',
])
const TRUTH_STATUSES = new Set<BrainTruthStatus>(['raw', 'interpreted', 'proposed', 'verified', 'superseded'])
const SENSITIVITIES = new Set<BrainSensitivity>(['normal', 'private', 'secret_reference'])
const RETENTIONS = new Set<BrainRetention>(['transient', 'project', 'permanent', 'until'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function cleanString(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    if (required) throw new Error('Required string is missing')
    return null
  }
  return value.trim().slice(0, max)
}

function identifier(value: unknown, name: string): string {
  const parsed = cleanString(value, 64, true) as string
  if (!/^[A-Za-z0-9._:-]{3,64}$/.test(parsed)) throw new Error(`${name} is invalid`)
  return parsed
}

function isoDate(value: unknown, name: string, required = false): string | null {
  const parsed = cleanString(value, 64, required)
  if (!parsed) return null
  const timestamp = Date.parse(parsed)
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be an ISO date`)
  return new Date(timestamp).toISOString()
}

function stringList(value: unknown, maxItems = 50, maxChars = 64): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxChars))
    .filter(Boolean))]
    .slice(0, maxItems)
}

function jsonRecord(value: unknown, maxChars: number): Record<string, unknown> {
  const parsed = record(value) ?? {}
  const encoded = JSON.stringify(parsed)
  if (encoded.length > maxChars) throw new Error(`Structured attributes exceed ${maxChars} characters`)
  return JSON.parse(encoded) as Record<string, unknown>
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T, name: string): T {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !values.has(value as T)) throw new Error(`${name} is invalid`)
  return value as T
}

export function normalizeBrainObjectCreate(value: unknown, now = new Date().toISOString()): BrainObject {
  const input = record(value)
  if (!input) throw new Error('Brain object body is required')
  const kind = enumValue(input.kind, OBJECT_KINDS, 'memory', 'kind')
  const retention = enumValue(input.retention, RETENTIONS, 'project', 'retention')
  const expiresAt = isoDate(input.expires_at, 'expires_at')
  if (retention === 'until' && !expiresAt) throw new Error('retention=until requires expires_at')
  const body = cleanString(input.body, 50_000)
  const title = cleanString(input.title, 300)
  if (!title && !body) throw new Error('A Brain object requires title or body')

  return {
    schema: BRAIN_SCHEMA_VERSION,
    object_id: identifier(input.object_id, 'object_id'),
    project_id: identifier(input.project_id, 'project_id'),
    mission_id: input.mission_id ? identifier(input.mission_id, 'mission_id') : null,
    kind,
    title,
    body,
    attributes: jsonRecord(input.attributes, 40_000),
    source_ids: stringList(input.source_ids),
    truth_status: enumValue(input.truth_status, TRUTH_STATUSES, kind === 'source' ? 'raw' : 'proposed', 'truth_status'),
    sensitivity: enumValue(input.sensitivity, SENSITIVITIES, 'normal', 'sensitivity'),
    retention,
    expires_at: retention === 'until' ? expiresAt : null,
    created_by: cleanString(input.created_by, 120, true) as string,
    created_at: isoDate(input.created_at, 'created_at') ?? now,
    updated_at: now,
    version: 1,
  }
}

export function normalizeBrainObjectUpdate(current: BrainObject, value: unknown, now = new Date().toISOString()): BrainObject {
  const input = record(value)
  if (!input) throw new Error('Brain object update body is required')
  const expectedVersion = Number(input.expected_version)
  if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
    throw new Error(`Brain object version mismatch: expected ${expectedVersion}, current ${current.version}`)
  }

  const retention = input.retention === undefined
    ? current.retention
    : enumValue(input.retention, RETENTIONS, current.retention, 'retention')
  const expiresAt = input.expires_at === undefined
    ? current.expires_at
    : isoDate(input.expires_at, 'expires_at')
  if (retention === 'until' && !expiresAt) throw new Error('retention=until requires expires_at')

  const updated: BrainObject = {
    ...current,
    title: input.title === undefined ? current.title : cleanString(input.title, 300),
    body: input.body === undefined ? current.body : cleanString(input.body, 50_000),
    attributes: input.attributes === undefined ? current.attributes : jsonRecord(input.attributes, 40_000),
    source_ids: input.source_ids === undefined ? current.source_ids : stringList(input.source_ids),
    truth_status: input.truth_status === undefined ? current.truth_status : enumValue(input.truth_status, TRUTH_STATUSES, current.truth_status, 'truth_status'),
    sensitivity: input.sensitivity === undefined ? current.sensitivity : enumValue(input.sensitivity, SENSITIVITIES, current.sensitivity, 'sensitivity'),
    retention,
    expires_at: retention === 'until' ? expiresAt : null,
    updated_at: now,
    version: current.version + 1,
  }
  if (!updated.title && !updated.body) throw new Error('A Brain object requires title or body')
  return updated
}

export function normalizeBrainRelation(value: unknown, now = new Date().toISOString()): BrainRelation {
  const input = record(value)
  if (!input) throw new Error('Brain relation body is required')
  return {
    schema: BRAIN_SCHEMA_VERSION,
    relation_id: identifier(input.relation_id, 'relation_id'),
    project_id: identifier(input.project_id, 'project_id'),
    mission_id: input.mission_id ? identifier(input.mission_id, 'mission_id') : null,
    from_object_id: identifier(input.from_object_id, 'from_object_id'),
    to_object_id: identifier(input.to_object_id, 'to_object_id'),
    relation_type: cleanString(input.relation_type, 120, true) as string,
    attributes: jsonRecord(input.attributes, 20_000),
    created_by: cleanString(input.created_by, 120, true) as string,
    created_at: isoDate(input.created_at, 'created_at') ?? now,
  }
}

export function normalizeBrainEvent(value: unknown, now = new Date().toISOString()): BrainEvent {
  const input = record(value)
  if (!input) throw new Error('Brain event body is required')
  return {
    schema: BRAIN_SCHEMA_VERSION,
    event_id: identifier(input.event_id, 'event_id'),
    project_id: identifier(input.project_id, 'project_id'),
    mission_id: input.mission_id ? identifier(input.mission_id, 'mission_id') : null,
    object_id: input.object_id ? identifier(input.object_id, 'object_id') : null,
    event_type: cleanString(input.event_type, 120, true) as string,
    actor_id: cleanString(input.actor_id, 120, true) as string,
    summary: cleanString(input.summary, 1000, true) as string,
    details: jsonRecord(input.details, 30_000),
    occurred_at: isoDate(input.occurred_at, 'occurred_at') ?? now,
  }
}

export function isBrainObjectKind(value: string | null): value is BrainObjectKind {
  return value !== null && OBJECT_KINDS.has(value as BrainObjectKind)
}
