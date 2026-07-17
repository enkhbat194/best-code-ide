import * as gh from './github'
import type { RepoContext } from './types'

export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and folders at one directory path in the selected repository.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path, empty string for repository root' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tree',
      description: 'List the complete recursive repository tree. Use this first to understand project structure.',
      parameters: { type: 'object', properties: { max_entries: { type: 'number', description: 'Maximum entries to return, default 500' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search code in the repository by keyword, symbol, error text, or filename fragment.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read one file from the selected repository branch.',
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
      name: 'read_files',
      description: 'Read up to 12 related files in one call. Prefer this after locating the relevant files.',
      parameters: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' } } },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or update a file and commit it to the currently selected branch. Read the file first.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Complete new UTF-8 file content' },
          message: { type: 'string', description: 'Specific commit message' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file and commit the deletion to the selected branch.',
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
      name: 'list_branches',
      description: 'List repository branches and protection status.',
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_branch',
      description: 'Create a safe working branch before modifying main/master.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'New branch name, preferably agent/<task>' },
          from: { type: 'string', description: 'Source branch, defaults to the selected branch' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_branches',
      description: 'Return a unified diff between a base branch and a head branch.',
      parameters: {
        type: 'object',
        properties: { base: { type: 'string' }, head: { type: 'string' } },
        required: ['base', 'head'],
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
      name: 'run_validation',
      description: 'Start the validate.yml GitHub Actions workflow on the selected or specified branch.',
      parameters: { type: 'object', properties: { branch: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validation_status',
      description: 'Get recent validate.yml workflow runs for the selected or specified branch.',
      parameters: { type: 'object', properties: { branch: { type: 'string' } } },
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
  ctx: RepoContext,
): Promise<string> {
  if (!token) throw new Error('GITHUB_TOKEN secret is missing')
  const { owner, repo, branch } = ctx

  switch (name) {
    case 'list_files': {
      const path = typeof args.path === 'string' ? args.path : ''
      const entries = await gh.listDir(token, owner, repo, path, branch)
      if (entries.length === 0) return '(empty directory)'
      return entries.map((entry) => `${entry.type === 'dir' ? 'dir ' : 'file'}  ${entry.path}${entry.type === 'file' ? ` (${entry.size}B)` : ''}`).join('\n')
    }
    case 'list_tree': {
      const max = typeof args.max_entries === 'number' ? Math.min(Math.max(Math.floor(args.max_entries), 1), 2000) : 500
      const entries = await gh.getTree(token, owner, repo, branch)
      const visible = entries.slice(0, max)
      const lines = visible.map((entry) => `${entry.type === 'tree' ? 'dir ' : 'file'}  ${entry.path}${entry.size ? ` (${entry.size}B)` : ''}`)
      if (entries.length > visible.length) lines.push(`... ${entries.length - visible.length} more entries omitted`)
      return lines.join('\n')
    }
    case 'search_code': {
      const query = String(args.query ?? '')
      const limit = typeof args.limit === 'number' ? args.limit : 20
      const results = await gh.searchCode(token, owner, repo, query, limit)
      if (results.length === 0) return `No matches for: ${query}`
      return results
        .map((result) => {
          const fragments = result.fragments.length > 0 ? `\n${result.fragments.join('\n---\n')}` : ''
          return `${result.path}${fragments}`
        })
        .join('\n\n')
    }
    case 'read_file': {
      const path = String(args.path ?? '')
      const file = await gh.getFile(token, owner, repo, path, branch)
      if (!file) return `File not found: ${path}`
      return file.content
    }
    case 'read_files': {
      const files = await gh.getFiles(token, owner, repo, asStringArray(args.paths), branch)
      return files
        .map((file) => `===== ${file.path} =====\n${file.error ? `ERROR: ${file.error}` : file.content ?? ''}`)
        .join('\n\n')
    }
    case 'write_file': {
      const path = String(args.path ?? '')
      const content = String(args.content ?? '')
      if (!path) throw new Error('path is required')
      const message = typeof args.message === 'string' && args.message ? args.message : `Update ${path}`
      const result = await gh.putFile(token, owner, repo, path, content, message, branch)
      return `Committed ${path} on ${branch} — ${result.commitUrl}`
    }
    case 'delete_file': {
      const path = String(args.path ?? '')
      if (!path) throw new Error('path is required')
      const message = typeof args.message === 'string' && args.message ? args.message : `Delete ${path}`
      await gh.deleteFile(token, owner, repo, path, message, branch)
      return `Deleted ${path} from ${branch}`
    }
    case 'list_branches': {
      const limit = typeof args.limit === 'number' ? args.limit : 30
      const branches = await gh.listBranches(token, owner, repo, limit)
      return branches.map((item) => `${item.name} ${item.sha.slice(0, 7)}${item.protected ? ' protected' : ''}`).join('\n')
    }
    case 'create_branch': {
      const branchName = String(args.name ?? '').trim()
      if (!branchName) throw new Error('name is required')
      const from = typeof args.from === 'string' && args.from.trim() ? args.from.trim() : branch
      const created = await gh.createBranch(token, owner, repo, branchName, from)
      return `Created branch ${created.name} from ${from} at ${created.sha.slice(0, 7)}. Switch the app branch setting to ${created.name} before editing.`
    }
    case 'compare_branches': {
      const base = String(args.base ?? '').trim()
      const head = String(args.head ?? '').trim()
      if (!base || !head) throw new Error('base and head are required')
      const diff = await gh.compareBranches(token, owner, repo, base, head)
      return diff || '(no differences)'
    }
    case 'list_commits': {
      const path = typeof args.path === 'string' ? args.path : undefined
      const limit = typeof args.limit === 'number' ? args.limit : 10
      const commits = await gh.listCommits(token, owner, repo, branch, path, limit)
      return commits.map((commit) => `${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]} (${commit.date})`).join('\n')
    }
    case 'run_validation': {
      const target = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : branch
      await gh.dispatchValidation(token, owner, repo, target)
      return `Validation workflow started on ${target}. Call validation_status to check the result.`
    }
    case 'validation_status': {
      const target = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : branch
      const runs = await gh.listValidationRuns(token, owner, repo, target)
      if (runs.length === 0) return `No validation runs found for ${target}`
      return runs.map((run) => `${run.id} ${run.status}/${run.conclusion ?? '-'} ${run.createdAt} ${run.url}`).join('\n')
    }
    case 'create_repo': {
      const repoName = String(args.name ?? '')
      if (!repoName) throw new Error('name is required')
      const isPrivate = args.private !== false
      const description = typeof args.description === 'string' ? args.description : undefined
      const result = await gh.createRepo(token, repoName, isPrivate, description)
      return `Created ${result.htmlUrl} (default branch: ${result.defaultBranch})`
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
