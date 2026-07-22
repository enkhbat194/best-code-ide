import { assetFromBrainObject, type AssetMetadata } from './assetSchema'
import {
  normalizeBrainEvent,
  normalizeBrainRelation,
  type BrainEvent,
  type BrainObject,
  type BrainRelation,
} from './brainSchema'

export const ASSET_RELATION_CONTRACT = 'asset-relation-v1' as const
export const ASSET_EVENT_CONTRACT = 'asset-event-v1' as const
export const ASSET_MANIFEST_SCHEMA = 'asset-manifest-v1' as const

export type AssetRelationType =
  | 'belongs_to_project'
  | 'used_by_mission'
  | 'attached_to_source'
  | 'generated_by'
  | 'derived_from'

export type AssetEventType =
  | 'asset_registered'
  | 'asset_uploaded'
  | 'asset_stored'
  | 'asset_linked'
  | 'asset_reused'
  | 'asset_unlinked'
  | 'asset_deleted'

export type ReadBrainObject = (objectId: string) => Promise<BrainObject | null>

const RELATION_TYPES = new Set<AssetRelationType>([
  'belongs_to_project',
  'used_by_mission',
  'attached_to_source',
  'generated_by',
  'derived_from',
])
const EVENT_TYPES = new Set<AssetEventType>([
  'asset_registered',
  'asset_uploaded',
  'asset_stored',
  'asset_linked',
  'asset_reused',
  'asset_unlinked',
  'asset_deleted',
])
const ACTIVE_REFERENCE_TYPES = new Set<AssetRelationType>([
  'used_by_mission',
  'attached_to_source',
  'generated_by',
  'derived_from',
])
const GENERATED_ORIGINS = new Set(['ai_generated', 'system_generated', 'repository_export'])
const ID_PATTERN = /^[A-Za-z0-9._:-]{3,64}$/

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value.trim())) throw new Error(`${name} is invalid`)
  return value.trim()
}

function cleanString(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    if (required) throw new Error('Required string is missing')
    return null
  }
  return value.trim().slice(0, max)
}

function jsonRecord(value: unknown, maxChars: number): Record<string, unknown> {
  const parsed = record(value) ?? {}
  const encoded = JSON.stringify(parsed)
  if (encoded.length > maxChars) throw new Error(`Structured attributes exceed ${maxChars} characters`)
  return JSON.parse(encoded) as Record<string, unknown>
}

function objectLookupKey(objectId: string): string {
  return `brain-object-id:${objectId}`
}

export function brainRelationKey(relation: Pick<BrainRelation, 'project_id' | 'relation_id'>): string {
  return `brain-relation:${relation.project_id}:${relation.relation_id}`
}

function brainEventKey(event: Pick<BrainEvent, 'project_id' | 'occurred_at' | 'event_id'>): string {
  return `brain-event:${event.project_id}:${event.occurred_at}:${event.event_id}`
}

function brainEventIdentityKey(event: Pick<BrainEvent, 'project_id' | 'event_id'>): string {
  return `brain-event-id:${event.project_id}:${event.event_id}`
}

export function relationIdentityKey(relation: Pick<BrainRelation, 'project_id' | 'from_object_id' | 'to_object_id' | 'relation_type'>): string {
  return `brain-relation-identity:${relation.project_id}:${relation.from_object_id}:${relation.relation_type}:${relation.to_object_id}`
}

function sameRelation(left: BrainRelation, right: BrainRelation): boolean {
  return left.project_id === right.project_id &&
    left.from_object_id === right.from_object_id &&
    left.to_object_id === right.to_object_id &&
    left.relation_type === right.relation_type
}

async function deterministicId(prefix: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = [...digest].map((item) => item.toString(16).padStart(2, '0')).join('')
  return `${prefix}:${hex.slice(0, 48)}`
}

function normalizeProvenance(value: unknown, actorId: string): Record<string, unknown> {
  const input = record(value) ?? {}
  const actorType = cleanString(input.actor_type, 40) ?? 'unknown'
  const normalized: Record<string, unknown> = {
    contract: 'provider-neutral-provenance-v1',
    actor_type: actorType,
    actor_id: cleanString(input.actor_id, 120) ?? actorId,
  }
  const tool = cleanString(input.tool, 160)
  const toolVersion = cleanString(input.tool_version, 80)
  const model = cleanString(input.model, 160)
  const provider = cleanString(input.provider, 120)
  const runId = cleanString(input.run_id, 64)
  if (tool) normalized.tool = tool
  if (toolVersion) normalized.tool_version = toolVersion
  if (model) normalized.model = model
  if (provider) normalized.provider = provider
  if (runId) normalized.run_id = runId
  return normalized
}

function assetMetadata(object: BrainObject): AssetMetadata {
  if (object.kind !== 'asset') throw new Error('Asset object is required')
  return assetFromBrainObject(object)
}

function isDeletedAssetObject(object: BrainObject): boolean {
  if (object.kind !== 'asset') return false
  try {
    return assetMetadata(object).upload_status === 'deleted'
  } catch {
    return true
  }
}

export async function putBrainRelationIdempotent(
  state: DurableObjectState,
  relation: BrainRelation,
): Promise<{ relation: BrainRelation; created: boolean; idempotent: boolean }> {
  const key = brainRelationKey(relation)
  const identityKey = relationIdentityKey(relation)
  const indexedKey = await state.storage.get<string>(identityKey)
  if (indexedKey) {
    const indexed = await state.storage.get<BrainRelation>(indexedKey)
    if (indexed) {
      if (!sameRelation(indexed, relation)) throw new Error('Relation identity conflicts with an existing relation')
      return { relation: indexed, created: false, idempotent: true }
    }
    await state.storage.delete(identityKey)
  }

  const existingById = await state.storage.get<BrainRelation>(key)
  if (existingById) {
    if (!sameRelation(existingById, relation)) throw new Error('Brain relation id already exists with different endpoints')
    await state.storage.put(identityKey, key)
    return { relation: existingById, created: false, idempotent: true }
  }

  await state.storage.put(key, relation)
  await state.storage.put(identityKey, key)
  return { relation, created: true, idempotent: false }
}

export async function deleteBrainRelation(
  state: DurableObjectState,
  relation: BrainRelation,
): Promise<void> {
  await state.storage.delete([brainRelationKey(relation), relationIdentityKey(relation)])
}

export async function recordAssetEvent(
  state: DurableObjectState,
  asset: AssetMetadata,
  eventType: AssetEventType,
  actorId: string,
  summary: string,
  details: Record<string, unknown> = {},
  token = String(asset.version),
): Promise<{ event: BrainEvent; created: boolean }> {
  if (!EVENT_TYPES.has(eventType)) throw new Error('Asset event type is invalid')
  const eventId = await deterministicId('ae', `${asset.project_id}:${asset.asset_id}:${eventType}:${token}`)
  const event = normalizeBrainEvent({
    event_id: eventId,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    object_id: asset.asset_id,
    event_type: eventType,
    actor_id: actorId,
    summary,
    details: {
      contract: ASSET_EVENT_CONTRACT,
      asset_id: asset.asset_id,
      origin: asset.origin,
      ...jsonRecord(details, 25_000),
    },
  })
  const identityKey = brainEventIdentityKey(event)
  const existingKey = await state.storage.get<string>(identityKey)
  if (existingKey) {
    const existing = await state.storage.get<BrainEvent>(existingKey)
    if (existing) return { event: existing, created: false }
    await state.storage.delete(identityKey)
  }
  const key = brainEventKey(event)
  await state.storage.put(key, event)
  await state.storage.put(identityKey, key)
  return { event, created: true }
}

function relationEndpoints(asset: AssetMetadata, relationType: AssetRelationType, targetId: string): {
  fromObjectId: string
  toObjectId: string
  targetKind: BrainObject['kind']
} {
  switch (relationType) {
    case 'belongs_to_project':
      return { fromObjectId: asset.asset_id, toObjectId: targetId, targetKind: 'project' }
    case 'used_by_mission':
      return { fromObjectId: asset.asset_id, toObjectId: targetId, targetKind: 'mission' }
    case 'attached_to_source':
      return { fromObjectId: targetId, toObjectId: asset.asset_id, targetKind: 'source' }
    case 'generated_by':
      return { fromObjectId: asset.asset_id, toObjectId: targetId, targetKind: 'agent_run' }
    case 'derived_from':
      return { fromObjectId: asset.asset_id, toObjectId: targetId, targetKind: 'asset' }
  }
}

export async function linkAsset(
  state: DurableObjectState,
  asset: AssetMetadata,
  value: unknown,
  readObject: ReadBrainObject,
): Promise<{ relation: BrainRelation; created: boolean; idempotent: boolean }> {
  const input = record(value)
  if (!input) throw new Error('Asset link body is required')
  const relationType = cleanString(input.relation_type, 120, true) as AssetRelationType
  if (!RELATION_TYPES.has(relationType)) throw new Error('Asset relation type is invalid')
  const targetId = identifier(input.target_object_id, 'target_object_id')
  const createdBy = cleanString(input.created_by, 120, true) as string
  const endpoints = relationEndpoints(asset, relationType, targetId)

  if (relationType === 'belongs_to_project') {
    if (targetId !== asset.project_id) throw new Error('Asset project relation must target its own project_id')
    const project = await readObject(targetId)
    if (project && (project.kind !== 'project' || project.project_id !== asset.project_id)) {
      throw new Error('Project relation target is invalid')
    }
  } else {
    const target = await readObject(targetId)
    if (!target) throw new Error('Asset relation target does not exist')
    if (target.project_id !== asset.project_id) throw new Error('Cross-project asset relations are forbidden')
    if (target.kind !== endpoints.targetKind) throw new Error(`Asset relation target must be ${endpoints.targetKind}`)
    if (target.kind === 'asset' && isDeletedAssetObject(target)) throw new Error('Deleted assets cannot be relation targets')
  }

  if (relationType === 'generated_by' || relationType === 'derived_from') {
    if (asset.asset_kind !== 'generated_artifact' || !GENERATED_ORIGINS.has(asset.origin)) {
      throw new Error(`${relationType} requires a generated artifact with protected generated origin`)
    }
    if (relationType === 'derived_from' && targetId === asset.asset_id) throw new Error('An asset cannot derive from itself')
  }

  const semantic = `${asset.project_id}:${endpoints.fromObjectId}:${relationType}:${endpoints.toObjectId}`
  const relationId = input.relation_id
    ? identifier(input.relation_id, 'relation_id')
    : await deterministicId('ar', semantic)
  const relation = normalizeBrainRelation({
    relation_id: relationId,
    project_id: asset.project_id,
    mission_id: relationType === 'used_by_mission' ? targetId : asset.mission_id,
    from_object_id: endpoints.fromObjectId,
    to_object_id: endpoints.toObjectId,
    relation_type: relationType,
    attributes: {
      contract: ASSET_RELATION_CONTRACT,
      asset_id: asset.asset_id,
      target_kind: endpoints.targetKind,
      provenance: normalizeProvenance(input.provenance, createdBy),
      ...jsonRecord(input.attributes, 12_000),
    },
    created_by: createdBy,
  })
  const result = await putBrainRelationIdempotent(state, relation)
  if (result.created) {
    await recordAssetEvent(
      state,
      asset,
      'asset_linked',
      createdBy,
      `Asset linked through ${relationType}.`,
      { relation_id: relation.relation_id, relation_type: relationType, target_object_id: targetId },
      relation.relation_id,
    )
  }
  return result
}

export async function linkAssetDefaults(
  state: DurableObjectState,
  asset: AssetMetadata,
  rawInput: unknown,
  readObject: ReadBrainObject,
): Promise<{ relations: BrainRelation[]; skipped: string[] }> {
  const input = record(rawInput) ?? {}
  const createdBy = cleanString(input.created_by, 120) ?? asset.created_by
  const provenance = input.provenance
  const relations: BrainRelation[] = []
  const skipped: string[] = []

  const add = async (relation_type: AssetRelationType, target_object_id: string, strict: boolean) => {
    try {
      const result = await linkAsset(state, asset, { relation_type, target_object_id, created_by: createdBy, provenance }, readObject)
      relations.push(result.relation)
    } catch (error) {
      if (strict) throw error
      skipped.push(`${relation_type}:${target_object_id}`)
    }
  }

  await add('belongs_to_project', asset.project_id, true)
  const requestedMissionId = input.mission_id === null || input.mission_id === undefined
    ? asset.mission_id
    : identifier(input.mission_id, 'mission_id')
  const requestedSourceId = input.source_id === null || input.source_id === undefined
    ? asset.source_id
    : identifier(input.source_id, 'source_id')
  if (requestedMissionId) await add('used_by_mission', requestedMissionId, false)
  if (requestedSourceId) await add('attached_to_source', requestedSourceId, false)

  const agentRunId = cleanString(input.agent_run_id, 64)
  if (agentRunId) await add('generated_by', identifier(agentRunId, 'agent_run_id'), true)

  const derived = Array.isArray(input.derived_from_asset_ids)
    ? [...new Set(input.derived_from_asset_ids.map((item) => identifier(item, 'derived_from_asset_id')))]
    : []
  for (const sourceAssetId of derived) await add('derived_from', sourceAssetId, true)

  const explicitLinks = Array.isArray(input.links) ? input.links.slice(0, 50) : []
  for (const link of explicitLinks) {
    const result = await linkAsset(state, asset, link, readObject)
    relations.push(result.relation)
  }

  return { relations, skipped }
}

function isAssetRelation(relation: BrainRelation, assetId: string): boolean {
  return RELATION_TYPES.has(relation.relation_type as AssetRelationType) &&
    (relation.from_object_id === assetId || relation.to_object_id === assetId)
}

export async function assetReferenceSummary(
  state: DurableObjectState,
  asset: AssetMetadata,
): Promise<{
  asset_id: string
  project_id: string
  active_reference_count: number
  total_relationship_count: number
  by_type: Record<string, number>
  relationships: BrainRelation[]
}> {
  const values = await state.storage.list<BrainRelation>({ prefix: `brain-relation:${asset.project_id}:` })
  const relationships = [...values.values()].filter((relation) => isAssetRelation(relation, asset.asset_id))
  const active = relationships.filter((relation) => ACTIVE_REFERENCE_TYPES.has(relation.relation_type as AssetRelationType))
  const byType: Record<string, number> = {}
  for (const relation of active) byType[relation.relation_type] = (byType[relation.relation_type] ?? 0) + 1
  return {
    asset_id: asset.asset_id,
    project_id: asset.project_id,
    active_reference_count: active.length,
    total_relationship_count: relationships.length,
    by_type: byType,
    relationships,
  }
}

export async function unlinkAssetRelation(
  state: DurableObjectState,
  asset: AssetMetadata,
  relationId: string,
  actorId: string,
): Promise<{ relation: BrainRelation | null; deleted: boolean; idempotent: boolean }> {
  const key = brainRelationKey({ project_id: asset.project_id, relation_id: identifier(relationId, 'relation_id') })
  const relation = await state.storage.get<BrainRelation>(key)
  if (!relation) return { relation: null, deleted: false, idempotent: true }
  if (!isAssetRelation(relation, asset.asset_id)) throw new Error('Relation does not belong to this asset')
  await deleteBrainRelation(state, relation)
  await recordAssetEvent(
    state,
    asset,
    'asset_unlinked',
    actorId,
    `Asset relation ${relation.relation_type} detached.`,
    { relation_id: relation.relation_id, relation_type: relation.relation_type },
    relation.relation_id,
  )
  return { relation, deleted: true, idempotent: false }
}

export async function cleanupAssetRelations(
  state: DurableObjectState,
  asset: AssetMetadata,
  readObject: ReadBrainObject,
): Promise<{ removed_relation_ids: string[]; remaining_relationship_count: number }> {
  const summary = await assetReferenceSummary(state, asset)
  const removed: string[] = []
  for (const relation of summary.relationships) {
    let remove = asset.upload_status === 'deleted'
    if (!remove && relation.relation_type !== 'belongs_to_project') {
      const otherId = relation.from_object_id === asset.asset_id ? relation.to_object_id : relation.from_object_id
      const other = await readObject(otherId)
      remove = !other || isDeletedAssetObject(other)
    }
    if (remove) {
      await deleteBrainRelation(state, relation)
      removed.push(relation.relation_id)
    }
  }
  const after = await assetReferenceSummary(state, asset)
  return { removed_relation_ids: removed, remaining_relationship_count: after.total_relationship_count }
}

export function buildAssetManifest(objects: BrainObject[], relations: BrainRelation[]): {
  schema: typeof ASSET_MANIFEST_SCHEMA
  count: number
  items: Array<AssetMetadata & { active_reference_count: number; relationship_count: number }>
  relationships: BrainRelation[]
} {
  const assets = objects.flatMap((object) => {
    if (object.kind !== 'asset') return []
    try {
      return [assetMetadata(object)]
    } catch {
      return []
    }
  })
  const assetIds = new Set(assets.map((asset) => asset.asset_id))
  const relationships = relations.filter((relation) =>
    RELATION_TYPES.has(relation.relation_type as AssetRelationType) &&
    (assetIds.has(relation.from_object_id) || assetIds.has(relation.to_object_id)))
  const items = assets.map((asset) => {
    const linked = relationships.filter((relation) => relation.from_object_id === asset.asset_id || relation.to_object_id === asset.asset_id)
    return {
      ...asset,
      active_reference_count: linked.filter((relation) => ACTIVE_REFERENCE_TYPES.has(relation.relation_type as AssetRelationType)).length,
      relationship_count: linked.length,
    }
  })
  return { schema: ASSET_MANIFEST_SCHEMA, count: items.length, items, relationships }
}

export async function lookupObjectById(state: DurableObjectState, objectId: string): Promise<BrainObject | null> {
  const key = await state.storage.get<string>(objectLookupKey(objectId))
  return key ? (await state.storage.get<BrainObject>(key) ?? null) : null
}
