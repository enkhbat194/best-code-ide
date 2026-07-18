import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalStore, isProjectTaskTransitionAllowed } from './approvalStore.ts'
import { executeSafeWriteMcpTool } from './mcpWriteTools.ts'
import { executeProjectBrainMcpTool, searchMemoryDocuments } from './projectBrainTools.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, value)
  }

  async list(options = {}) {
    const prefix = options.prefix ?? ''
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)))
  }
}

function createHarness() {
  const store = new ApprovalStore({ storage: new MemoryStorage() })
  const stub = {
    fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      return store.fetch(request)
    },
  }
  const env = {
    AUTH_TOKEN: 'test-auth-token',
    GITHUB_TOKEN: 'test-github-token',
    APPROVALS: {
      idFromName(name) {
        return name
      },
      get() {
        return stub
      },
    },
  }
  return { env, stub }
}

function encoded(content) {
  return btoa(unescape(encodeURIComponent(content)))
}

function githubJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installGithubFiles(t, files) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.github.com')
    assert.equal(request.headers.get('authorization'), 'Bearer test-github-token')
    const marker = '/contents/'
    const index = url.pathname.indexOf(marker)
    if (request.method !== 'GET' || index === -1) throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
    const path = decodeURIComponent(url.pathname.slice(index + marker.length))
    if (!(path in files)) return githubJson({ message: 'Not Found' }, 404)
    return githubJson({ type: 'file', sha: `sha-${path}`, content: encoded(files[path]) })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
}

test('locked project task lifecycle rejects invalid jumps', () => {
  assert.equal(isProjectTaskTransitionAllowed('planned', 'inspecting'), true)
  assert.equal(isProjectTaskTransitionAllowed('planned', 'completed'), false)
  assert.equal(isProjectTaskTransitionAllowed('completed', 'editing'), false)
  assert.equal(isProjectTaskTransitionAllowed('blocked', 'editing'), true)
  assert.equal(isProjectTaskTransitionAllowed('validating', 'editing'), true)
})

test('canonical memory search returns bounded line-numbered evidence', () => {
  const results = searchMemoryDocuments(
    [
      {
        path: 'BESTCODE_MASTER.md',
        content: '# Goal\nChatGPT and Claude share one Project Brain.\nDeepSeek reads Preview diagnostics.',
      },
      { path: 'docs/PROJECT_STATUS.md', content: '# Status\nProject Brain is current.' },
    ],
    'DeepSeek diagnostics',
    5,
    1,
  )

  assert.equal(results.length, 1)
  assert.equal(results[0].path, 'BESTCODE_MASTER.md')
  assert.equal(results[0].start_line, 2)
  assert.equal(results[0].end_line, 3)
  assert.match(results[0].snippet, /Preview diagnostics/)

  assert.deepEqual(
    searchMemoryDocuments([{ path: 'README.md', content: '# BestCode\nNo punctuation marker.' }], '!!!', 5, 1),
    [],
  )
})

test('Project Brain shares canonical context, durable tasks, and handoffs', async (t) => {
  const { env } = createHarness()
  installGithubFiles(t, {
    'BESTCODE_MASTER.md': '# Locked Master\nChatGPT, Claude, and DeepSeek use one Project Brain.',
    'docs/PROJECT_STATUS.md': '# Status\nPhase 2 is current.',
    'docs/ARCHITECTURE.md': '# Architecture\nProvider-neutral controller.',
    'docs/ROADMAP.md': '# Roadmap\nProject Brain v1.',
    'README.md': '# BestCode',
  })

  const started = await executeProjectBrainMcpTool(
    'project_task_start',
    { project_id: 'bestcode', goal: 'Build Project Brain v1', created_by: 'chatgpt' },
    'test-github-token',
    env,
  )
  assert.equal(started.structuredContent.ok, true)
  assert.equal(started.structuredContent.result.task.status, 'planned')
  const taskId = started.structuredContent.task_id

  const invalid = await executeProjectBrainMcpTool(
    'project_task_update',
    {
      project_id: 'bestcode',
      task_id: taskId,
      status: 'completed',
      summary: 'Not actually complete',
      evidence: ['manual:claim'],
    },
    'test-github-token',
    env,
  )
  assert.equal(invalid.structuredContent.ok, false)
  assert.match(invalid.structuredContent.error.message, /cannot move from planned to completed/)

  const inspecting = await executeProjectBrainMcpTool(
    'project_task_update',
    {
      project_id: 'bestcode',
      task_id: taskId,
      status: 'inspecting',
      branch: 'agent/project-brain-v1',
      next_action: 'Read the canonical context.',
    },
    'test-github-token',
    env,
  )
  assert.equal(inspecting.structuredContent.result.task.status, 'inspecting')

  const handoff = await executeProjectBrainMcpTool(
    'project_handoff_record',
    {
      project_id: 'bestcode',
      task_id: taskId,
      from_agent: 'chatgpt',
      to_agent: 'claude',
      summary: 'Master is locked and the task foundation is ready.',
      next_actions: ['Continue implementation'],
      evidence: ['github:agent/project-brain-v1'],
    },
    'test-github-token',
    env,
  )
  assert.equal(handoff.structuredContent.ok, true)
  assert.equal(handoff.structuredContent.result.handoff.to_agent, 'claude')

  const context = await executeProjectBrainMcpTool(
    'project_context_get',
    { project_id: 'bestcode' },
    'test-github-token',
    env,
  )
  assert.equal(context.structuredContent.ok, true)
  assert.equal(context.structuredContent.result.context_version, 'project-brain-v1')
  assert.equal(context.structuredContent.result.canonical_documents.length, 5)
  assert.equal(context.structuredContent.result.project_tasks.length, 1)
  assert.equal(context.structuredContent.result.handoffs.length, 1)
  assert.equal(context.structuredContent.result.project_tasks[0].verification, 'reported_metadata')
  assert.deepEqual(context.structuredContent.result.source_priority.slice(0, 2), ['github_main', 'production_deployment'])
})

test('canonical Project Brain file changes are always high risk', async (t) => {
  const { env } = createHarness()
  installGithubFiles(t, { 'BESTCODE_MASTER.md': '# Old master' })

  const result = await executeSafeWriteMcpTool(
    'repository_write_file',
    {
      project_id: 'bestcode',
      branch: 'agent/master-change',
      path: 'BESTCODE_MASTER.md',
      content: '# New master',
    },
    'test-github-token',
    env,
  )

  assert.equal(result.structuredContent.ok, true)
  assert.equal(result.structuredContent.result.risk, 'high')
  assert.ok(result.structuredContent.result.risk_reasons.includes('project_brain_source_of_truth_change'))
})
