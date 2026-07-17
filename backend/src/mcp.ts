import { executeTool, toolSchemas } from './tools'
import { CORS_HEADERS, resolveSecret } from './utils'
import type { Env } from './types'

const REPO_PARAMS = {
  owner: { type: 'string', description: 'GitHub repository owner or organization' },
  repo: { type: 'string', description: 'GitHub repository name' },
  branch: { type: 'string', description: 'Selected branch, defaults to main' },
}

const MCP_TOOLS = toolSchemas.map((schema) => {
  const fn = schema.function
  if (fn.name === 'create_repo') {
    return { name: fn.name, description: fn.description, inputSchema: fn.parameters }
  }
  const parameters = fn.parameters as {
    type: string
    properties?: Record<string, unknown>
    required?: readonly string[]
  }
  return {
    name: fn.name,
    description: fn.description,
    inputSchema: {
      type: 'object',
      properties: { ...REPO_PARAMS, ...(parameters.properties ?? {}) },
      required: ['owner', 'repo', ...(parameters.required ?? [])],
    },
  }
})

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

/** Streamable HTTP MCP endpoint for Claude, Gemini-compatible clients, and other MCP hosts. */
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
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'best-code-ide', version: '0.2.0' },
      })

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202, headers: CORS_HEADERS })

    case 'ping':
      return rpcResponse(rpc.id, {})

    case 'tools/list':
      return rpcResponse(rpc.id, { tools: MCP_TOOLS })

    case 'tools/call': {
      const githubToken = resolveSecret(env, 'GITHUB_TOKEN')
      if (!githubToken) {
        return rpcResponse(rpc.id, {
          content: [{ type: 'text', text: 'GITHUB_TOKEN secret is missing' }],
          isError: true,
        })
      }

      const name = String(rpc.params?.name ?? '')
      const args = (rpc.params?.arguments as Record<string, unknown>) ?? {}
      if (!name) return rpcError(rpc.id, -32602, 'Missing tool name')

      if (name === 'create_repo') {
        try {
          const result = await executeTool(name, args, githubToken, { owner: '', repo: '', branch: '' })
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
        const result = await executeTool(name, rest, githubToken, {
          owner: String(owner),
          repo: String(repo),
          branch: branch ? String(branch) : 'main',
        })
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
