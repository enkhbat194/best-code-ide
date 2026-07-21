import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const localAgentSource = await readFile(
  new URL('../../frontend/src/lib/localAgent.ts', import.meta.url),
  'utf8',
)

test('assistant tool calls preserve the provider-required function type across agent rounds', () => {
  assert.match(localAgentSource, /interface RawToolCall\s*{[\s\S]*type: 'function'/)
  assert.match(
    localAgentSource,
    /message\.tool_calls = realCalls\.map\([\s\S]*type: 'function',[\s\S]*function: { name: call\.name, arguments: call\.arguments }/,
  )
})

test('tool result messages keep the matching tool_call_id for the next provider request', () => {
  assert.match(
    localAgentSource,
    /messages\.push\({ role: 'tool', tool_call_id: id, content: result\.slice\(0, MAX_RESULT_CHARS\) }\)/,
  )
})
