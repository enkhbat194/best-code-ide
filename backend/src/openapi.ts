import { deliveryMcpTools } from './mcpDeliveryTools'
import { deploymentMcpTools } from './mcpDeploymentTools'
import { readOnlyMcpTools } from './mcpReadTools'
import { rollbackMcpTools } from './mcpRollbackTools'
import { safeWriteMcpTools } from './mcpWriteTools'
import { buildActionDescription } from './openapiDescription'
import { projectBrainMcpTools } from './projectBrainTools'
import { missionMcpTools } from './missionTools'

const ACTION_TOOLS = [...readOnlyMcpTools, ...safeWriteMcpTools, ...deliveryMcpTools, ...deploymentMcpTools, ...rollbackMcpTools, ...projectBrainMcpTools, ...missionMcpTools]

function tagFor(name: string): string {
  if (name.startsWith('mission_')) return 'Missions'
  if (name.startsWith('project_context_') || name.startsWith('project_memory_') || name.startsWith('project_task_') || name.startsWith('project_handoff_')) return 'Project Brain'
  if (name.startsWith('projects_') || name.startsWith('project_')) return 'Projects'
  if (name.startsWith('build_') || name.startsWith('test_') || name.startsWith('task_')) return 'Build and test'
  if (name.startsWith('deployment_')) return 'Deployment'
  if (name.startsWith('rollback_')) return 'Rollback'
  if (name.startsWith('approval_')) return 'Approvals'
  if (name.startsWith('preview_')) return 'Preview'
  return 'Repository'
}

function safetyNote(tool: (typeof ACTION_TOOLS)[number]): string {
  if (tool.annotations.readOnlyHint) return 'This action is read-only.'
  if (tool.name.startsWith('mission_')) return 'This action changes Mission coordination metadata only. It cannot modify repository code, dispatch providers, deploy, or switch production traffic.'
  if (tool.name === 'repository_create_branch') return 'This action may create only a safe agent/<task> working branch. It cannot write to main/master.'
  if (tool.name === 'repository_write_file' || tool.name === 'repository_apply_patch' || tool.name === 'repository_delete_file') return 'This action stages a diff only. It does not commit or push. The user must approve the operation in BestCode.'
  if (tool.name === 'repository_delete_branch') return 'The first call creates a high-risk approval. A second call may delete only the same unchanged approved non-default, non-protected branch.'
  if (tool.name === 'repository_commit') return 'This action requires an already approved code-change operation and prepares a commit object without moving the branch ref.'
  if (tool.name === 'repository_push') return 'This action fast-forwards an approved prepared commit. Force push and main/master are blocked.'
  if (tool.name === 'deployment_start') return 'The first call creates a separate high-risk approval and does not deploy. A second call with the approved operation ID may dispatch only the configured workflow from the project default branch.'
  if (tool.name === 'rollback_request') return 'This action creates only an exact-target high-risk rollback approval. It never switches production traffic or dispatches the rollback workflow.'
  if (tool.name === 'project_task_start' || tool.name === 'project_task_update' || tool.name === 'project_handoff_record') return 'This action changes coordination metadata only. It cannot modify repository code or override GitHub, CI, deployment, or the locked Master plan.'
  return 'This action follows BestCode project allowlists, protected-branch rules, approval requirements, and durable task state.'
}

function actionPaths(): Record<string, object> {
  const paths: Record<string, object> = {}
  for (const tool of ACTION_TOOLS) {
    paths[`/api/actions/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.title,
        description: buildActionDescription(tool.description, safetyNote(tool)),
        tags: [tagFor(tool.name)],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: tool.inputSchema } } },
        responses: {
          '200': { description: 'Structured BestCode tool result. Check ok, status, result, and error fields.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolEnvelope' } } } },
          '400': { description: 'Invalid action request', content: { 'application/json': { schema: { $ref: '#/components/schemas/HttpError' } } } },
          '401': { description: 'Missing or invalid Bearer token', content: { 'application/json': { schema: { $ref: '#/components/schemas/HttpError' } } } },
          '404': { description: 'Unknown action or resource', content: { 'application/json': { schema: { $ref: '#/components/schemas/HttpError' } } } },
          '500': { description: 'BestCode server configuration error', content: { 'application/json': { schema: { $ref: '#/components/schemas/HttpError' } } } },
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
      description: 'Project-scoped GitHub, Mission, and IDE controller for ChatGPT Actions. Use projects_list first, work only on agent/<task> branches, stage code changes for user approval, and use Mission tools for shared coordination state.',
      version: '0.11.0',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Projects', description: 'Allowed project registry.' },
      { name: 'Project Brain', description: 'Canonical context, memory search, durable cross-agent tasks, and handoffs.' },
      { name: 'Missions', description: 'Durable Mission lifecycle, graph, lease, idempotent mutation, and context packets.' },
      { name: 'Repository', description: 'Repository inspection, staged changes, Git delivery, and pull requests.' },
      { name: 'Approvals', description: 'Read approval state. Approval decisions remain user-only in the BestCode UI.' },
      { name: 'Build and test', description: 'GitHub Actions task start, status, logs, and cancellation.' },
      { name: 'Deployment', description: 'Approval-gated production deployment request, status, and logs.' },
      { name: 'Rollback', description: 'Exact-target, high-risk rollback request contract. Request creation never changes production traffic.' },
      { name: 'Preview', description: 'Configured project preview metadata.' },
    ],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'BestCode AUTH_TOKEN' } },
      schemas: {
        RepositoryRef: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, full_name: { type: 'string' } }, required: ['owner', 'repo', 'full_name'], additionalProperties: false },
        ToolError: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, action_required: { type: 'string' } }, required: ['code', 'message', 'retryable', 'action_required'], additionalProperties: false },
        ToolEnvelope: { type: 'object', properties: { ok: { type: 'boolean' }, operation_id: { type: 'string' }, task_id: { type: 'string' }, status: { type: 'string' }, project_id: { type: 'string' }, repository: { $ref: '#/components/schemas/RepositoryRef' }, branch: { type: 'string' }, approval_required: { type: 'boolean' }, result: { type: 'object', additionalProperties: true }, error: { $ref: '#/components/schemas/ToolError' } }, required: ['ok', 'operation_id', 'status'], additionalProperties: true },
        HttpError: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
      },
    },
    paths: actionPaths(),
  }
}
