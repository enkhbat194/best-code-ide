import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  normalizeBrainEvent,
  normalizeBrainObjectCreate,
  normalizeBrainObjectUpdate,
  normalizeBrainRelation,
} from './brainSchema.ts'

const storeSource = await readFile(new URL('./brainStore.ts', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('./brainApi.ts', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
const typesSource = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
const wranglerSource = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8')

const now = '2026-07-22T05:00:00.000Z'

test('Brain v2 preserves raw source text and structured interpretation separately', () => {
  const raw = 'x'.repeat(10_000)
  const object = normalizeBrainObjectCreate({
    object_id: 'source-unit1-0001',
    project_id: 'czech-app',
    mission_id: 'mission-unit1-0001',
    kind: 'source',
    title: 'Owner request',
    body: raw,
    attributes: {
      interpreted_goal: 'Unit 1-ийн аудиог шалгах',
      expected_audio_count: 25,
    },
    created_by: 'owner',
  }, now)

  assert.equal(object.body, raw)
  assert.equal(object.truth_status, 'raw')
  assert.equal(object.attributes.expected_audio_count, 25)
  assert.equal(object.version, 1)
  assert.ok(JSON.stringify(object).length > 3800, 'Brain v2 object must not inherit the Mission v1 3800-char envelope')
})

test('Brain v2 updates require the current object version', () => {
  const current = normalizeBrainObjectCreate({
    object_id: 'mission-unit1-0001',
    project_id: 'czech-app',
    kind: 'mission',
    title: 'Unit 1 audit',
    created_by: 'owner',
  }, now)

  const updated = normalizeBrainObjectUpdate(current, {
    expected_version: 1,
    truth_status: 'verified',
    attributes: { status: 'planned' },
  }, '2026-07-22T05:01:00.000Z')

  assert.equal(updated.version, 2)
  assert.equal(updated.truth_status, 'verified')
  assert.throws(() => normalizeBrainObjectUpdate(updated, { expected_version: 1, title: 'stale' }, now), /version mismatch/)
})

test('Brain v2 relations and events keep provider-neutral provenance', () => {
  const relation = normalizeBrainRelation({
    relation_id: 'relation-source-mission-1',
    project_id: 'czech-app',
    mission_id: 'mission-unit1-0001',
    from_object_id: 'source-unit1-0001',
    to_object_id: 'mission-unit1-0001',
    relation_type: 'belongs_to',
    created_by: '4b-ingestion',
  }, now)
  const event = normalizeBrainEvent({
    event_id: 'event-source-captured-1',
    project_id: 'czech-app',
    mission_id: 'mission-unit1-0001',
    object_id: 'source-unit1-0001',
    event_type: 'source_captured',
    actor_id: 'bestcode-chat',
    summary: 'Owner source captured without changing its original text.',
  }, now)

  assert.equal(relation.relation_type, 'belongs_to')
  assert.equal(event.event_type, 'source_captured')
  assert.equal(event.actor_id, 'bestcode-chat')
})

test('Brain v2 is an authenticated, separately bound Durable Object API', () => {
  assert.match(typesSource, /BRAIN_STORE: DurableObjectNamespace/)
  assert.match(indexSource, /export \{ BrainStore \} from '\.\/brainStore'/)
  assert.match(indexSource, /handleBrainApi\(req, env, url\)/)
  assert.match(apiSource, /startsWith\('\/api\/brain\/'\)/)
  assert.match(apiSource, /idFromName\('bestcode-brain-v2'\)/)
  assert.match(wranglerSource, /name = "BRAIN_STORE"/)
  assert.match(wranglerSource, /class_name = "BrainStore"/)
  assert.match(wranglerSource, /tag = "brain-store-v2"/)
  assert.match(storeSource, /brain-object:/)
  assert.match(storeSource, /brain-relation:/)
  assert.match(storeSource, /brain-event:/)
  assert.doesNotMatch(storeSource, /3800|mission-record-v1/)
})
