import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const closeoutSource = await readFile(new URL('../../frontend/src/lib/phase4BCloseout.ts', import.meta.url), 'utf8')
const viewSource = await readFile(new URL('../../frontend/src/components/mission/Phase4BOwnerCloseout.tsx', import.meta.url), 'utf8')
const workspaceSource = await readFile(new URL('../../frontend/src/components/mission/MissionWorkspace.tsx', import.meta.url), 'utf8')


test('Phase 4B owner closeout requires image, file and URL metadata without binary reads', () => {
  assert.match(closeoutSource, /kinds\.has\('image'\)/)
  assert.match(closeoutSource, /kinds\.has\('file'\)/)
  assert.match(closeoutSource, /kinds\.has\('url'\)/)
  assert.match(closeoutSource, /serializeIntentWithReferences/)
  assert.match(viewSource, /accept="image\/\*"/)
  assert.match(viewSource, /accept="\.pdf,\.txt,\.md,\.json,\.csv,\.doc,\.docx"/)
  assert.match(viewSource, /createUrlReference/)
  assert.doesNotMatch(`${closeoutSource}\n${viewSource}`, /FileReader|arrayBuffer\(|readAsDataURL|base64/i)
})


test('Phase 4B closeout seeds and resolves all Decision inbox owner outcomes safely', () => {
  for (const status of ['accepted', 'rejected', 'superseded']) {
    assert.match(closeoutSource, new RegExp(`expectedStatus: '${status}'`))
  }
  assert.match(closeoutSource, /mutation: 'record_decision'/)
  assert.match(closeoutSource, /command: 'acquire'/)
  assert.match(closeoutSource, /command: 'release'/)
  assert.match(closeoutSource, /transitionMission\(mission, 'decision'\)/)
  assert.match(closeoutSource, /resolveMissionDecision/)
  assert.match(closeoutSource, /mission\.writer_lease === null/)
  assert.match(closeoutSource, /mission\.lifecycle === 'planned'/)
})


test('Mission workspace exposes a dedicated owner-visible 4B Test mode', () => {
  assert.match(workspaceSource, /type WorkspaceMode = 'mission' \| 'chat' \| 'closeout'/)
  assert.match(workspaceSource, /4B Test/)
  assert.match(workspaceSource, /<Phase4BOwnerCloseout \/>/)
  assert.match(viewSource, /Phase 4B owner closeout амжилттай/)
})
