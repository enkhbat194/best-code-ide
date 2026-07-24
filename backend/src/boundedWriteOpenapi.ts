const ownerSecurity = [{ bearerAuth: [] }]
const errorResponse = {
  description: 'Owner authentication, Mission authority, or scope validation failed.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/HttpError' } } },
}

export function boundedWriteOpenapiSpec(origin: string): object {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BestCode Bounded Write Owner API',
      version: '1.0.0',
      description: 'Owner-only issue, status, revoke, and emergency-revoke API. Agent mutation tools are advertised separately by the credential-bound MCP endpoint.',
    },
    servers: [{ url: origin }],
    security: ownerSecurity,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'BestCode owner AUTH_TOKEN' },
      },
      schemas: {
        HttpError: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
        IssueCredential: {
          type: 'object',
          required: [
            'project_id', 'mission_id', 'execution_plan_id', 'task_id', 'attempt_id', 'lease_id',
            'fencing_token', 'agent_id', 'provider', 'branch', 'base_sha', 'allowed_tools',
            'allowed_paths', 'limits', 'idempotency_namespace', 'approval_record_id',
          ],
          additionalProperties: false,
          properties: {
            project_id: { type: 'string' },
            mission_id: { type: 'string' },
            execution_plan_id: { type: 'string' },
            task_id: { type: 'string' },
            attempt_id: { type: 'string' },
            lease_id: { type: 'string' },
            fencing_token: { type: 'integer', minimum: 1 },
            agent_id: { type: 'string' },
            provider: { type: 'string' },
            branch: { type: 'string', pattern: '^agent/' },
            base_sha: { type: 'string', pattern: '^[a-fA-F0-9]{40,64}$' },
            allowed_tools: { type: 'array', minItems: 1, items: { type: 'string' } },
            allowed_paths: { type: 'array', minItems: 1, items: { type: 'string' } },
            denied_paths: { type: 'array', items: { type: 'string' } },
            expires_in_seconds: { type: 'integer', minimum: 300, maximum: 7200, default: 1800 },
            limits: { type: 'object', additionalProperties: false },
            idempotency_namespace: { type: 'string' },
            approval_record_id: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/api/bounded-write/credentials': {
        post: {
          operationId: 'bounded_write_credential_issue',
          summary: 'Issue one owner-approved bounded write credential',
          description: 'Requires an active approved Mission task, attempt, lease, fencing token, exact scope, and owner bearer. The raw credential is returned once.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueCredential' } } },
          },
          responses: { '201': { description: 'One-time credential issue response.' }, '400': errorResponse, '401': errorResponse, '409': errorResponse },
        },
        get: {
          operationId: 'bounded_write_credential_list',
          summary: 'List safe bounded write credential status',
          description: 'Returns public credential records only. Raw credentials and secret verifiers are never returned.',
          parameters: [
            { name: 'project_id', in: 'query', schema: { type: 'string' } },
            { name: 'mission_id', in: 'query', schema: { type: 'string' } },
            { name: 'task_id', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Safe credential status list.' }, '401': errorResponse },
        },
      },
      '/api/bounded-write/credentials/{credential_id}': {
        get: {
          operationId: 'bounded_write_credential_get',
          summary: 'Read safe credential status',
          description: 'Returns bindings, expiry, usage, limits, and status without raw credential or verifier.',
          parameters: [{ name: 'credential_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Safe credential status.' }, '401': errorResponse, '404': errorResponse },
        },
      },
      '/api/bounded-write/credentials/{credential_id}/revoke': {
        post: {
          operationId: 'bounded_write_credential_revoke',
          summary: 'Revoke one bounded write credential',
          description: 'Owner-only idempotent revoke. Revocation immediately prevents further mutation authorization.',
          parameters: [{ name: 'credential_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Revoked safe status.' }, '401': errorResponse, '404': errorResponse },
        },
      },
      '/api/bounded-write/tasks/{task_id}/status': {
        get: {
          operationId: 'bounded_write_task_status',
          summary: 'Read write-task authority and credentials',
          description: 'Returns task, owner approval gate, current lease, and safe credential status for one exact project and Mission.',
          parameters: [
            { name: 'task_id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'project_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'mission_id', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Authoritative write-task status.' }, '401': errorResponse, '409': errorResponse },
        },
      },
      '/api/bounded-write/tasks/{task_id}/revoke-all': {
        post: {
          operationId: 'bounded_write_task_emergency_revoke',
          summary: 'Emergency-revoke all task credentials',
          description: 'Owner-only bounded cleanup for one exact project, Mission, and task. It cannot affect another task or Mission.',
          parameters: [
            { name: 'task_id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'project_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'mission_id', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Revoked safe status list.' }, '401': errorResponse, '409': errorResponse },
        },
      },
    },
  }
}
