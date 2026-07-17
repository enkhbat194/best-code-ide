import * as gh from './github'
import type { RepoContext } from './types'

export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and folders at a path in the repo.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path, empty string for repo root' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the repo.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path, e.g. src/App.tsx' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or update a file and commit it directly to the branch.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Full new file content' },
          message: { type: 'string', description: 'Commit message' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file and commit the deletion.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, message: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_commits',
      description: 'List recent commits, optionally filtered to a path.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, limit: { type: 'number' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_repo',
      description: 'Create a new GitHub repository under the authenticated account.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          private: { type: 'boolean', description: 'Defaults to true' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
] as const

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  ctx: RepoContext,
): Promise<string> {
  const { owner, repo, branch } = ctx

  switch (name) {
    case 'list_files': {
      const path = typeof args.path === 'string' ? args.path : ''
      const entries = await gh.listDir(token, owner, repo, path, branch)
      if (entries.length === 0) return '(empty directory)'
      return entries.map((e) => `${e.type === 'dir' ? 'dir ' : 'file'}  ${e.path}${e.type === 'file' ? ` (${e.size}B)` : ''}`).join('\n')
    }
    case 'read_file': {
      const path = String(args.path ?? '')
      const file = await gh.getFile(token, owner, repo, path, branch)
      if (!file) return `File not found: ${path}`
      return file.content
    }
    case 'write_file': {
      const path = String(args.path ?? '')
      const content = String(args.content ?? '')
      const message = typeof args.message === 'string' && args.message ? args.message : `Update ${path}`
      const result = await gh.putFile(token, owner, repo, path, content, message, branch)
      return `Committed ${path} — ${result.commitUrl}`
    }
    case 'delete_file': {
      const path = String(args.path ?? '')
      const message = typeof args.message === 'string' && args.message ? args.message : `Delete ${path}`
      await gh.deleteFile(token, owner, repo, path, message, branch)
      return `Deleted ${path}`
    }
    case 'list_commits': {
      const path = typeof args.path === 'string' ? args.path : undefined
      const limit = typeof args.limit === 'number' ? args.limit : 10
      const commits = await gh.listCommits(token, owner, repo, branch, path, limit)
      return commits.map((c) => `${c.sha.slice(0, 7)} ${c.message.split('\n')[0]} (${c.date})`).join('\n')
    }
    case 'create_repo': {
      const repoName = String(args.name ?? '')
      if (!repoName) return 'Error: name is required'
      const isPrivate = args.private !== false
      const description = typeof args.description === 'string' ? args.description : undefined
      const result = await gh.createRepo(token, repoName, isPrivate, description)
      return `Created ${result.htmlUrl} (default branch: ${result.defaultBranch})`
    }
    default:
      return `Unknown tool: ${name}`
  }
}
