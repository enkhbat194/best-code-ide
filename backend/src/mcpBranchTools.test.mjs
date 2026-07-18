import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalStore } from './approvalStore.ts'
import { executeReadOnlyMcpTool } from './mcpReadTools.ts'
import { executeSafeWriteMcpTool } from './mcpWriteTools.ts'

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

function createApprovalHarness() {
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

function githubJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installGithubFetch(t, handler) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    assert.equal(new URL(request.url).hostname, 'api.github.com')
    assert.equal(request.headers.get('authorization'), 'Bearer test-github-token')
    return handler(request)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
}

async function approve(stub, operationId) {
  const response = await stub.fetch(`https://approval-store/operations/${operationId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved', actor: 'test-user' }),
  })
  assert.equal(response.status, 200)
}

test('branch list and comparison execute through the real tool path', async (t) => {
  const { env } = createApprovalHarness()
  installGithubFetch(t, async (request) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/branches')) {
      assert.equal(url.searchParams.get('per_page'), '100')
      return githubJson([
        { name: 'main', protected: true, commit: { sha: 'main-sha' } },
        { name: 'agent/feature', protected: false, commit: { sha: 'feature-sha' } },
      ])
    }
    if (url.pathname.includes('/compare/')) {
      return githubJson({
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        commits: [
          { sha: 'commit-1', html_url: 'https://github.test/commit-1', commit: { message: 'First' } },
          { sha: 'commit-2', html_url: 'https://github.test/commit-2', commit: { message: 'Second' } },
        ],
        files: [
          { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, changes: 4 },
        ],
      })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  })

  const listed = await executeReadOnlyMcpTool(
    'repository_list_branches',
    { project_id: 'bestcode' },
    'test-github-token',
    env,
  )
  assert.equal(listed.structuredContent.ok, true)
  assert.equal(listed.structuredContent.result.count, 2)
  assert.deepEqual(listed.structuredContent.result.items[0], {
    name: 'main',
    sha: 'main-sha',
    protected: true,
    default: true,
  })

  const compared = await executeReadOnlyMcpTool(
    'repository_compare_branch',
    { project_id: 'bestcode', branch: 'agent/feature' },
    'test-github-token',
    env,
  )
  assert.equal(compared.structuredContent.ok, true)
  assert.equal(compared.structuredContent.result.status, 'ahead')
  assert.equal(compared.structuredContent.result.ahead_by, 2)
  assert.equal(compared.structuredContent.result.fully_merged_into_base, false)
  assert.equal(compared.structuredContent.result.commits.length, 2)
  assert.equal(compared.structuredContent.result.files[0].filename, 'src/a.ts')
})

test('branch deletion requires approval, records completion, and is safely idempotent', async (t) => {
  const { env, stub } = createApprovalHarness()
  let branchReads = 0
  let deleteCalls = 0
  installGithubFetch(t, async (request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/obsolete')) {
      branchReads += 1
      return githubJson({ name: 'agent/obsolete', protected: false, commit: { sha: 'approved-sha' } })
    }
    if (request.method === 'DELETE' && url.pathname.endsWith('/git/refs/heads/agent/obsolete')) {
      deleteCalls += 1
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  })

  const pending = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    { project_id: 'bestcode', branch: 'agent/obsolete' },
    'test-github-token',
    env,
  )
  assert.equal(pending.structuredContent.ok, true)
  assert.equal(pending.structuredContent.status, 'pending_approval')
  assert.equal(pending.structuredContent.result.sha, 'approved-sha')
  assert.equal(deleteCalls, 0)

  const unapproved = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    {
      project_id: 'bestcode',
      branch: 'agent/obsolete',
      approval_operation_id: pending.structuredContent.operation_id,
    },
    'test-github-token',
    env,
  )
  assert.equal(unapproved.structuredContent.ok, false)
  assert.equal(unapproved.structuredContent.error.code, 'BRANCH_DELETE_APPROVAL_REQUIRED')
  assert.equal(deleteCalls, 0)

  await approve(stub, pending.structuredContent.operation_id)
  const completed = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    {
      project_id: 'bestcode',
      branch: 'agent/obsolete',
      approval_operation_id: pending.structuredContent.operation_id,
    },
    'test-github-token',
    env,
  )
  assert.equal(completed.structuredContent.ok, true)
  assert.equal(completed.structuredContent.status, 'completed')
  assert.equal(completed.structuredContent.result.deleted_sha, 'approved-sha')
  assert.equal(deleteCalls, 1)

  const storedResponse = await stub.fetch(
    `https://approval-store/operations/${pending.structuredContent.operation_id}`,
  )
  const stored = await storedResponse.json()
  assert.equal(stored.status, 'completed')
  assert.ok(stored.completed_at)

  const repeated = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    {
      project_id: 'bestcode',
      branch: 'agent/obsolete',
      approval_operation_id: pending.structuredContent.operation_id,
    },
    'test-github-token',
    env,
  )
  assert.equal(repeated.structuredContent.ok, true)
  assert.equal(repeated.structuredContent.result.already_completed, true)
  assert.equal(deleteCalls, 1)

  const wrongBranch = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    {
      project_id: 'bestcode',
      branch: 'agent/other',
      approval_operation_id: pending.structuredContent.operation_id,
    },
    'test-github-token',
    env,
  )
  assert.equal(wrongBranch.structuredContent.ok, false)
  assert.equal(wrongBranch.structuredContent.error.code, 'BRANCH_DELETE_APPROVAL_MISMATCH')
  assert.equal(deleteCalls, 1)
  assert.equal(branchReads, 3)
})

test('branch deletion rejects a changed SHA without deleting the branch', async (t) => {
  const { env, stub } = createApprovalHarness()
  let branchReads = 0
  let deleteCalls = 0
  installGithubFetch(t, async (request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/moved')) {
      branchReads += 1
      const sha = branchReads === 1 ? 'old-sha' : 'new-sha'
      return githubJson({ name: 'agent/moved', protected: false, commit: { sha } })
    }
    if (request.method === 'DELETE') {
      deleteCalls += 1
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  })

  const pending = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    { project_id: 'bestcode', branch: 'agent/moved' },
    'test-github-token',
    env,
  )
  await approve(stub, pending.structuredContent.operation_id)

  const result = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    {
      project_id: 'bestcode',
      branch: 'agent/moved',
      approval_operation_id: pending.structuredContent.operation_id,
    },
    'test-github-token',
    env,
  )
  assert.equal(result.structuredContent.ok, false)
  assert.equal(result.structuredContent.error.code, 'BRANCH_DELETE_APPROVAL_MISMATCH')
  assert.match(result.structuredContent.error.message, /current branch SHA/)
  assert.equal(deleteCalls, 0)
})

test('branch deletion blocks local and GitHub-protected branches', async (t) => {
  const { env } = createApprovalHarness()
  let githubCalls = 0
  installGithubFetch(t, async (request) => {
    githubCalls += 1
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname.endsWith('/branches/agent/protected')) {
      return githubJson({ name: 'agent/protected', protected: true, commit: { sha: 'protected-sha' } })
    }
    throw new Error(`Unexpected GitHub request: ${request.method} ${request.url}`)
  })

  const main = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    { project_id: 'bestcode', branch: 'main' },
    'test-github-token',
    env,
  )
  assert.equal(main.structuredContent.ok, false)
  assert.equal(main.structuredContent.error.code, 'PROTECTED_BRANCH')
  assert.equal(githubCalls, 0)

  const protectedResult = await executeSafeWriteMcpTool(
    'repository_delete_branch',
    { project_id: 'bestcode', branch: 'agent/protected' },
    'test-github-token',
    env,
  )
  assert.equal(protectedResult.structuredContent.ok, false)
  assert.equal(protectedResult.structuredContent.error.code, 'PROTECTED_BRANCH')
  assert.equal(githubCalls, 1)
})
