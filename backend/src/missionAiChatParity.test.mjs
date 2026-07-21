import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const missionToolsSource = await readFile(
  new URL('../../frontend/src/lib/missionAgentTools.ts', import.meta.url),
  'utf8',
)
const localAgentSource = await readFile(
  new URL('../../frontend/src/lib/localAgent.ts', import.meta.url),
  'utf8',
)
const chatViewSource = await readFile(
  new URL('../../frontend/src/components/chat/ChatView.tsx', import.meta.url),
  'utf8',
)

test('regular AI Chat exposes the three read-only durable Mission tools', () => {
  for (const tool of ['mission_list', 'mission_get', 'mission_context_packet']) {
    assert.match(missionToolsSource, new RegExp(`name: '${tool}'`))
  }
  assert.match(missionToolsSource, /Read-only\./)
  assert.doesNotMatch(missionToolsSource, /createMissionFromIntent|resolveMissionDecision|mission_mutate/)
})

test('AI Chat routes Mission tool calls and treats Mission IDs as backend records', () => {
  assert.match(localAgentSource, /\.\.\.MISSION_AGENT_TOOL_SCHEMAS/)
  assert.match(localAgentSource, /executeMissionAgentTool\(name, args\)/)
  assert.match(localAgentSource, /Mission Canvas records are durable backend objects, not local files/)
  assert.match(localAgentSource, /use mission_context_packet first/)
  assert.match(localAgentSource, /Never ask where a Mission file is when a Mission ID is available/)
  assert.match(chatViewSource, /Mission ID эсвэл хийх ажлаа бичих/)
})
