import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const closeoutSource = await readFile(new URL('../../frontend/src/lib/phase4BCloseout.ts', import.meta.url), 'utf8')
const viewSource = await readFile(new URL('../../frontend/src/components/mission/Phase4BOwnerCloseout.tsx', import.meta.url), 'utf8')
const workspaceSource = await readFile(new URL('../../frontend/src/components/mission/MissionWorkspace.tsx', import.meta.url), 'utf8')


test('Phase 4B owner closeout requires bounded image, file and URL metadata without binary reads', () => {
  assert.match(closeoutSource, /kinds\.has\('image'\)/)
  assert.match(closeoutSource, /kinds\.has\('file'\)/)
  assert.match(closeoutSource, /kinds\.has\('url'\)/)
  assert.match(closeoutSource, /serializeCloseoutReferences/)
  assert.match(closeoutSource, /compact\(reference\.label, 32\)/)
  assert.match(closeoutSource, /kind === 'url' \? 96 : 56/)
  assert.doesNotMatch(closeoutSource, /serializeIntentWithReferences/)
  assert.match(viewSource, /accept="image\/\*"/)
  assert.match(viewSource, /accept="\.pdf,\.txt,\.md,\.json,\.csv,\.doc,\.docx"/)
  assert.match(viewSource, /createUrlReference/)
  assert.doesNotMatch(`${closeoutSource}\n${viewSource}`, /FileReader|arrayBuffer\(|readAsDataURL|base64/i)
})


test('Phase 4B closeout v2 stays below bounded v1 storage during the final leased mutation', () => {
  assert.match(closeoutSource, /PHASE4B_CLOSEOUT_TITLE_PREFIX = '4B closeout v2'/)
  assert.match(closeoutSource, /acceptanceCriteria: \[\]/)

  const id = 'a'.repeat(36)
  const timestamp = '2026-07-22T00:00:00.000Z'
  const title = '4B closeout v2 · 2026. 7. 22. 03:04:35'
  const outcome = `4B owner closeout (binary хадгалаагүй):\n- зураг: ${'n'.repeat(32)} (${'d'.repeat(56)})\n- файл: ${'n'.repeat(32)} (${'d'.repeat(56)})\n- URL: ${'n'.repeat(32)} (${'d'.repeat(96)})`
  const statuses = ['accepted', 'rejected', 'superseded']
  const mission = {
    mission_id: id,
    project_id: 'bestcode',
    title,
    lifecycle: 'decision',
    goals: [{ goal_id: id, title, outcome, created_at: timestamp }],
    acceptance_criteria: [],
    decisions: statuses.map((status, index) => ({
      decision_id: `${String(index + 1)}${'b'.repeat(35)}`,
      title: ['[4B] Accept', '[4B] Reject', '[4B] Supersede'][index],
      status,
      rationale: `4B ${status}`,
      decided_at: timestamp,
    })),
    tasks: [],
    operations: [
      { operation_id: id, kind: 'mission_mutation:add_goal', status: 'completed', task_id: null, idempotency_key: `mission.canvas.capture.${id}`, created_at: timestamp, updated_at: timestamp },
      ...statuses.flatMap((status, index) => {
        const decisionId = `${String(index + 1)}${'b'.repeat(35)}`
        return [
          { operation_id: `${String(index + 2)}${'c'.repeat(35)}`, kind: 'mission_mutation:record_decision', status: 'completed', task_id: null, idempotency_key: `p4b.s.${id}.${['a', 'r', 's'][index]}`, created_at: timestamp, updated_at: timestamp },
          { operation_id: `${String(index + 5)}${'d'.repeat(35)}`, kind: 'mission_mutation:resolve_decision', status: 'completed', task_id: null, idempotency_key: `p4b.r.${decisionId}.${['a', 'r', 's'][index]}`, created_at: timestamp, updated_at: timestamp },
        ]
      }),
    ],
    writer_lease: {
      lease_id: id,
      holder_id: `p4b-${id}`,
      acquired_at: timestamp,
      heartbeat_at: timestamp,
      expires_at: timestamp,
      context_version: 20,
    },
    context_version: 20,
    context_hash: 'fnv1a32:12345678',
    created_at: timestamp,
    updated_at: timestamp,
  }
  const encoded = JSON.stringify({ schema: 'mission-record-v1', mission })
  assert.ok(encoded.length < 3800, `closeout payload must stay below 3800 chars, got ${encoded.length}`)
})


test('Phase 4B closeout seeds and resolves all Decision inbox owner outcomes safely', () => {
  for (const status of ['accepted', 'rejected', 'superseded']) {
    assert.match(closeoutSource, new RegExp(`expectedStatus: '${status}'`))
  }
  assert.match(closeoutSource, /mutation: 'record_decision'/)
  assert.match(closeoutSource, /mutation: 'resolve_decision'/)
  assert.match(closeoutSource, /command: 'acquire'/)
  assert.match(closeoutSource, /command: 'release'/)
  assert.match(closeoutSource, /transitionMission\(mission, 'decision'\)/)
  assert.match(closeoutSource, /transitionMission\(latest, 'planned'\)/)
  assert.match(closeoutSource, /mission\.writer_lease === null/)
  assert.match(closeoutSource, /mission\.lifecycle === 'planned'/)
})


test('Mission workspace exposes a dedicated owner-visible 4B Test mode', () => {
  assert.match(workspaceSource, /type WorkspaceMode = 'mission' \| 'chat' \| 'closeout'/)
  assert.match(workspaceSource, /4B Test/)
  assert.match(workspaceSource, /<Phase4BOwnerCloseout \/>/)
  assert.match(viewSource, /Phase 4B owner closeout амжилттай/)
})
