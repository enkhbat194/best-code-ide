import {
  assetReferenceSummary,
  buildAssetManifest,
  cleanupAssetRelations,
  deleteBrainRelation,
  linkAsset,
  putBrainRelationIdempotent,
  unlinkAssetRelation,
} from './assetLifecycle'
import { assetFromBrainObject } from './assetSchema'
import { handleAssetStore } from './assetStore'
import {
  isBrainObjectKind,
  normalizeBrainEvent,
  normalizeBrainObjectCreate,
  normalizeBrainObjectUpdate,
  normalizeBrainRelation,
  type BrainEvent,
  type BrainObject,
  type BrainRelation,
} from './brainSchema'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function objectKey(object: Pick<BrainObject, 'project_id' | 'kind' | 'object_id'>): string {
  return `brain-object:${object.project_id}:${object.kind}:${object.object_id}`
}

function objectLookupKey(objectId: string): string {
  return `brain-object-id:${objectId}`
}

function relationKey(relation: Pick<BrainRelation, 'project_id' | 'relation_id'>): string {
  return `brain-relation:${relation.project_id}:${relation.relation_id}`
}

function eventKey(event: Pick<BrainEvent, 'project_id' | 'occurred_at' | 'event_id'>): string {
  return `brain-event:${event.project_id}:${event.occurred_at}:${event.event_id}`
}

function eventIdentityKey(event: Pick<BrainEvent, 'project_id' | 'event_id'>): string {
  return `brain-event-id:${event.project_id}:${event.event_id}`
}

function validIdentifier(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{3,64}$/.test(value)
}

function decodedPathIdentifier(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return validIdentifier(decoded) ? decoded : null
  } catch {
    return null
  }
}

function boundedLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), max)
}

function isExpired(object: BrainObject, now = Date.now()): boolean {
  return object.retention === 'until' && object.expires_at !== null && Date.parse(object.expires_at) <= now
}

function isDeletedAsset(object: BrainObject): boolean {
  if (object.kind !== 'asset') return false
  try {
    return assetFromBrainObject(object).upload_status === 'deleted'
  } catch {
    return true
  }
}

export class BrainStore {
  constructor(private readonly state: DurableObjectState) {}

  private async readObject(objectId: string): Promise<BrainObject | null> {
    const key = await this.state.storage.get<string>(objectLookupKey(objectId))
    if (!key) return null
    const object = await this.state.storage.get<BrainObject>(key)
    if (!object) {
      await this.state.storage.delete(objectLookupKey(objectId))
      return null
    }
    if (isExpired(object)) {
      await this.state.storage.delete([key, objectLookupKey(objectId)])
      return null
    }
    return object
  }

  private async readAsset(assetId: string) {
    const object = await this.readObject(assetId)
    if (!object || object.kind !== 'asset') return null
    try {
      return assetFromBrainObject(object)
    } catch {
      return null
    }
  }

  private async listObjects(url: URL): Promise<Response> {
    const projectId = url.searchParams.get('project_id')
    if (!validIdentifier(projectId)) return json({ error: 'A valid project_id is required' }, 400)
    const kind = url.searchParams.get('kind')
    if (kind && !isBrainObjectKind(kind)) return json({ error: 'Invalid Brain object kind' }, 400)
    const missionId = url.searchParams.get('mission_id')
    if (missionId && !validIdentifier(missionId)) return json({ error: 'Invalid mission_id' }, 400)
    const truthStatus = url.searchParams.get('truth_status')
    const limit = boundedLimit(url.searchParams.get('limit'), 50, 200)
    const prefix = kind ? `brain-object:${projectId}:${kind}:` : `brain-object:${projectId}:`
    const values = await this.state.storage.list<BrainObject>({ prefix })
    const expiredKeys: string[] = []
    const items = [...values.entries()]
      .filter(([key, object]) => {
        if (isExpired(object)) {
          expiredKeys.push(key, objectLookupKey(object.object_id))
          return false
        }
        return (!missionId || object.mission_id === missionId) && (!truthStatus || object.truth_status === truthStatus)
      })
      .map(([, object]) => object)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    if (expiredKeys.length) await this.state.storage.delete(expiredKeys)
    return json({ items: items.slice(0, limit), count: Math.min(items.length, limit), total: items.length })
  }

  private async exportProject(url: URL): Promise<Response> {
    const projectId = url.searchParams.get('project_id')
    if (!validIdentifier(projectId)) return json({ error: 'A valid project_id is required' }, 400)
    const [objects, relations, events] = await Promise.all([
      this.state.storage.list<BrainObject>({ prefix: `brain-object:${projectId}:` }),
      this.state.storage.list<BrainRelation>({ prefix: `brain-relation:${projectId}:` }),
      this.state.storage.list<BrainEvent>({ prefix: `brain-event:${projectId}:` }),
    ])
    const liveObjects = [...objects.values()].filter((object) => !isExpired(object))
    const objectMap = new Map(liveObjects.map((object) => [object.object_id, object]))
    const liveRelations = [...relations.values()].filter((relation) => {
      const from = objectMap.get(relation.from_object_id)
      const to = objectMap.get(relation.to_object_id)
      const implicitProject = relation.relation_type === 'belongs_to_project' && relation.to_object_id === projectId
      return Boolean(from && !isDeletedAsset(from) && ((to && !isDeletedAsset(to)) || implicitProject))
    })
    const danglingRelationshipCount = relations.size - liveRelations.length
    return json({
      schema: 'brain-export-v2',
      project_id: projectId,
      exported_at: new Date().toISOString(),
      objects: liveObjects,
      relations: liveRelations,
      events: [...events.values()].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)),
      asset_manifest: buildAssetManifest(liveObjects, liveRelations),
      cleanup: { dangling_relationship_count: danglingRelationshipCount },
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)

    try {
      const assetResponse = await handleAssetStore(request, this.state, (objectId) => this.readObject(objectId))
      if (assetResponse) return assetResponse

      if (segments[0] === 'assets' && segments[1]) {
        const assetId = segments[1]
        if (!validIdentifier(assetId)) return json({ error: 'Invalid asset id' }, 400)
        const asset = await this.readAsset(assetId)
        if (!asset) return json({ error: 'Asset not found' }, 404)

        if (request.method === 'POST' && segments[2] === 'links' && segments.length === 3) {
          const result = await linkAsset(this.state, asset, await request.json().catch(() => null), (objectId) => this.readObject(objectId))
          return json(result, result.created ? 201 : 200)
        }
        if (request.method === 'DELETE' && segments[2] === 'links' && segments[3]) {
          const actorId = url.searchParams.get('actor_id') ?? 'owner'
          const result = await unlinkAssetRelation(this.state, asset, segments[3], actorId)
          return json(result)
        }
        if (request.method === 'GET' && segments[2] === 'references' && segments.length === 3) {
          return json(await assetReferenceSummary(this.state, asset))
        }
        if (request.method === 'POST' && segments[2] === 'cleanup' && segments.length === 3) {
          return json(await cleanupAssetRelations(this.state, asset, (objectId) => this.readObject(objectId)))
        }
      }

      if (request.method === 'POST' && url.pathname === '/objects') {
        const object = normalizeBrainObjectCreate(await request.json().catch(() => null))
        if (object.kind === 'asset') return json({ error: 'Use /assets for typed asset metadata' }, 409)
        if (await this.state.storage.get(objectLookupKey(object.object_id))) return json({ error: 'Brain object already exists' }, 409)
        const key = objectKey(object)
        await this.state.storage.put(key, object)
        await this.state.storage.put(objectLookupKey(object.object_id), key)
        return json(object, 201)
      }

      if (request.method === 'GET' && url.pathname === '/objects') return this.listObjects(url)

      if (segments[0] === 'objects' && segments[1]) {
        const objectId = decodedPathIdentifier(segments[1])
        if (!objectId) return json({ error: 'Invalid Brain object id' }, 400)
        const current = await this.readObject(objectId)
        if (!current) return json({ error: 'Brain object not found' }, 404)
        if (request.method === 'GET' && segments.length === 2) return json(current)
        if (request.method === 'POST' && segments[2] === 'update') {
          if (current.kind === 'asset') return json({ error: 'Use /assets/:asset_id/update for typed asset metadata' }, 409)
          const updated = normalizeBrainObjectUpdate(current, await request.json().catch(() => null))
          await this.state.storage.put(objectKey(updated), updated)
          return json(updated)
        }
      }

      if (request.method === 'POST' && url.pathname === '/relations') {
        const relation = normalizeBrainRelation(await request.json().catch(() => null))
        const [from, to] = await Promise.all([
          this.readObject(relation.from_object_id),
          this.readObject(relation.to_object_id),
        ])
        if (!from || !to) return json({ error: 'Relation objects must exist' }, 409)
        if (from.project_id !== relation.project_id || to.project_id !== relation.project_id) {
          return json({ error: 'Relation objects must belong to the same project' }, 409)
        }
        const result = await putBrainRelationIdempotent(this.state, relation)
        return json(result.relation, result.created ? 201 : 200)
      }

      if (request.method === 'DELETE' && segments[0] === 'relations' && segments[1]) {
        const projectId = url.searchParams.get('project_id')
        if (!validIdentifier(projectId)) return json({ error: 'A valid project_id is required' }, 400)
        const relation = await this.state.storage.get<BrainRelation>(relationKey({ project_id: projectId, relation_id: segments[1] }))
        if (!relation) return json({ deleted: false, idempotent: true })
        await deleteBrainRelation(this.state, relation)
        return json({ relation, deleted: true, idempotent: false })
      }

      if (request.method === 'GET' && url.pathname === '/relations') {
        const projectId = url.searchParams.get('project_id')
        if (!validIdentifier(projectId)) return json({ error: 'A valid project_id is required' }, 400)
        const objectId = url.searchParams.get('object_id')
        if (objectId && !validIdentifier(objectId)) return json({ error: 'Invalid object_id' }, 400)
        const relationType = url.searchParams.get('relation_type')
        const limit = boundedLimit(url.searchParams.get('limit'), 100, 500)
        const values = await this.state.storage.list<BrainRelation>({ prefix: `brain-relation:${projectId}:` })
        const items = [...values.values()]
          .filter((item) => (!objectId || item.from_object_id === objectId || item.to_object_id === objectId) && (!relationType || item.relation_type === relationType))
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        return json({ items: items.slice(0, limit), count: Math.min(items.length, limit), total: items.length })
      }

      if (request.method === 'POST' && url.pathname === '/events') {
        const event = normalizeBrainEvent(await request.json().catch(() => null))
        if (event.object_id) {
          const object = await this.readObject(event.object_id)
          if (!object || object.project_id !== event.project_id) return json({ error: 'Event object must exist in the same project' }, 409)
        }
        const identityKey = eventIdentityKey(event)
        const existingKey = await this.state.storage.get<string>(identityKey)
        if (existingKey) {
          const existing = await this.state.storage.get<BrainEvent>(existingKey)
          if (existing) return json(existing)
          await this.state.storage.delete(identityKey)
        }
        const key = eventKey(event)
        await this.state.storage.put(key, event)
        await this.state.storage.put(identityKey, key)
        return json(event, 201)
      }

      if (request.method === 'GET' && url.pathname === '/events') {
        const projectId = url.searchParams.get('project_id')
        if (!validIdentifier(projectId)) return json({ error: 'A valid project_id is required' }, 400)
        const missionId = url.searchParams.get('mission_id')
        const eventType = url.searchParams.get('event_type')
        const limit = boundedLimit(url.searchParams.get('limit'), 100, 500)
        const values = await this.state.storage.list<BrainEvent>({ prefix: `brain-event:${projectId}:`, reverse: true })
        const items = [...values.values()]
          .filter((item) => (!missionId || item.mission_id === missionId) && (!eventType || item.event_type === eventType))
          .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
        return json({ items: items.slice(0, limit), count: Math.min(items.length, limit), total: items.length })
      }

      if (request.method === 'GET' && url.pathname === '/export') return this.exportProject(url)

      return json({ error: 'Not found' }, 404)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
}
