import { executeTool } from './tools'
import { CORS_HEADERS } from './utils'
import type { Env } from './types'

const REPO_PARAMS = {
  owner: { type: 'string', description: 'GitHub repo owner/org' },
  repo: { type: 'string', description: 'GitHub repo name' },
  branch: { type: 'string', description: 'Branch name, defaults to main' },
}

const MCP_TOOLS = [
  {
    name: 'list_files',
    description: 'List files and folders at a path in a GitHub repo.',
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PARAMS, path: { type: 'string', description: 'Directory path, empty for root' } },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in a GitHub repo.',
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PARAMS, path: { type: 'string' } },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or update a file and commit it directly to the branch — the same as pushing from a terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        ...REPO_PARAMS,
        path: { type: 'string' },
        content: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['owner', 'repo', 'path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file and commit the deletion.',
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PARAMS, path: { type: 'string' }, message: { type: 'string' } },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'list_commits',
    description: 'List recent commits on a branch, optionally filtered to a path.',
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PARAMS, path: { type: 'string' }, limit: { type: 'number' } },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_repo',
    description: 'Create a new GitHub repository under the authenticated account.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, private: { type: 'boolean' }, description: { type: 'string' } },
      required: ['name'],
    },
  },
]

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

function rpcResponse(id: string | number | undefined, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function rpcError(id: string | number | undefined, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

/**
 * Minimal MCP server (Streamable HTTP, non-streaming variant): one JSON-RPC
 * request per POST, one JSON-RPC response back. Enough for Claude's custom
 * connector UI, which drives tools/list + tools/call one at a time.
 */
export async function handleMcp(req: Request, env: Env): Promise<Response> {
  let rpc: JsonRpcRequest
  try {
    rpc = await req.json()
  } catch {
    return rpcError(undefined, -32700, 'Parse error')
  }

  switch (rpc.method) {
    case 'initialize':
      return rpcResponse(rpc.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'best-code-ide', version: '0.1.0' },
      })

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202, headers: CORS_HEADERS })

    case 'ping':
      return rpcResponse(rpc.id, {})

    case 'tools/list':
      return rpcResponse(rpc.id, { tools: MCP_TOOLS })

    case 'tools/call': {
      const name = String(rpc.params?.name ?? '')
      const args = (rpc.params?.arguments as Record<string, unknown>) ?? {}
      if (!name) return rpcError(rpc.id, -32602, 'Missing tool name')

      if (name === 'create_repo') {
        try {
          const result = await executeTool(name, args, env.GITHUB_TOKEN, { owner: '', repo: '', branch: '' })
          return rpcResponse(rpc.id, { content: [{ type: 'text', text: result }] })
        } catch (err) {
          return rpcResponse(rpc.id, {
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
          })
        }
      }

      const { owner, repo, branch, ...rest } = args
      if (!owner || !repo) {
        return rpcResponse(rpc.id, {
          content: [{ type: 'text', text: 'owner and repo are required arguments' }],
          isError: true,
        })
      }
      try {
        const result = await executeTool(
          name,
          rest,
          env.GITHUB_TOKEN,
          { owner: String(owner), repo: String(repo), branch: branch ? String(branch) : 'main' },
        )
        return rpcResponse(rpc.id, { content: [{ type: 'text', text: result }] })
      } catch (err) {
        return rpcResponse(rpc.id, {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        })
      }
    }

    default:
      return rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`)
  }
}
