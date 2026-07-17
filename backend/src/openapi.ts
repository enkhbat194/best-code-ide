import { deliveryMcpTools } from './mcpDeliveryTools'
import { deploymentMcpTools } from './mcpDeploymentTools'
import { readOnlyMcpTools } from './mcpReadTools'
import { safeWriteMcpTools } from './mcpWriteTools'

const ACTION_TOOLS = [...readOnlyMcpTools, ...safeWriteMcpTools, ...deliveryMcpTools, ...deploymentMcpTools]

function tagFor(name: string): string {
  if (name.startsWith('projects_') || name.startsWith('project_')) return 'Projects'
  if (name.startsWith('build_') || name.startsWith('test_') || name.startsWith('task_')) return 'Build and test'
  if (name.startsWith('deployment_')) return 'Deployment'
  if (name.startsWith('approval_')) return 'Approvals'
  if (name.startsWith('preview_')) return 'Preview'
  return 'Repository'
}

function safetyNote(tool: (typeof ACTION_TOOLS)[number]): string {
  if (tool.annotations.readOnlyHint) return 'This action is read-only.'
  if (tool.name === 'repository_create_branch') {
    return 'This action may create only a safe agent/<task> working branch. It cannot write to main/master.'
  }
  if (tool.name === 'repository_write_file' || tool.name === 'repository_apply_patch' || tool.name === 'repository_delete_file') {
    return 'This action stages a diff only. It does not commit or push. The user must approve the operation in BestCode.'
  }
  if (tool.name === 'repository_commit') {
    return 'This action requires an already approved code-change operation and prepares a commit object without moving the branch ref.'
  }
  if (tool.name === 'repository_push') {
    return 'This action fast-forwards an approved prepared commit. Force push and main/master are blocked.'
  }
  if (tool.name === 'deployment_start') {
    return 'The first call creates a separate high-risk approval and does not deploy. A second call with the approved operation ID may dispatch only the configured workflow from the project default branch.'
  }
  return 'This action follows BestCode project allowlists, protected-branch rules, approval requirements, and durable task state.'
}

function actionPaths(): Record<string, object> {
  const paths: Record<string, object> = {}
  for (const tool of ACTION_TOOLS) {
    paths[`/api/actions/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.title,
        description: `${tool.description}\n\n${safetyNote(tool)}`,
        tags: [tagFor(tool.name)],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: tool.inputSchema,
            },
          },
        },
        responses: {
          '200': {
            description: 'Structured BestCode tool result. Check ok, status, result, and error fields.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ToolEnvelope' },
              },
            },
          },
          '400': {
            description: 'Invalid action request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HttpError' },
              },
            },
          },
          '401': {
            description: 'Missing or invalid Bearer token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HttpError' },
              },
            },
          },
          '404': {
            description: 'Unknown action or resource',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HttpError' },
              },
            },
          },
          '500': {
            description: 'BestCode server configuration error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HttpError' },
              },
            },
          },
        },
      },
    }
  }
  return paths
}

/** OpenAPI 3.1 schema for ChatGPT Custom GPT Actions and other REST clients. */
export function openapiSpec(origin: string): object {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BestCode Repository Controller',
      description:
        'Project-scoped GitHub and IDE controller for ChatGPT Actions. Use projects_list first, work only on agent/<task> branches, stage code changes for user approval, commit, push, build, test, open a draft pull request, then request a separate production deployment approval.',
      version: '0.7.0',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Projects', description: 'Allowed project registry.' },
      { name: 'Repository', description: 'Repository inspection, staged changes, Git delivery, and pull requests.' },
      { name: 'Approvals', description: 'Read approval state. Approval decisions remain user-only in the BestCode UI.' },
      { name: 'Build and test', description: 'GitHub Actions task start, status, logs, and cancellation.' },
      { name: 'Deployment', description: 'Approval-gated production deployment request, status, and logs.' },
      { name: 'Preview', description: 'Configured project preview metadata.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'BestCode AUTH_TOKEN',
        },
      },
      schemas: {
        RepositoryRef: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            full_name: { type: 'string' },
          },
          required: ['owner', 'repo', 'full_name'],
          additionalProperties: false,
        },
        ToolError: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
            action_required: { type: 'string' },
          },
          required: ['code', 'message', 'retryable', 'action_required'],
          additionalProperties: false,
        },
        ToolEnvelope: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            operation_id: { type: 'string' },
            task_id: { type: 'string' },
            status: { type: 'string' },
            project_id: { type: 'string' },
            repository: { $ref: '#/components/schemas/RepositoryRef' },
            branch: { type: 'string' },
            approval_required: { type: 'boolean' },
            result: { type: 'object', additionalProperties: true },
            error: { $ref: '#/components/schemas/ToolError' },
          },
          required: ['ok', 'operation_id', 'status'],
          additionalProperties: true,
        },
        HttpError: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
    paths: actionPaths(),
  }
}
