/** OpenAPI 3.1 schema for the REST surface, consumable as a ChatGPT Custom GPT Action. */
export function openapiSpec(origin: string): object {
  return {
    openapi: '3.1.0',
    info: {
      title: 'best-code-ide repo agent',
      description: 'Read, write, and commit files directly to a GitHub repo from an AI chat.',
      version: '0.1.0',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    paths: {
      '/api/repos': {
        post: {
          operationId: 'createRepo',
          summary: 'Create a new GitHub repository',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    private: { type: 'boolean' },
                    description: { type: 'string' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: { '200': { description: 'Repo created' } },
        },
      },
      '/api/repos/{owner}/{repo}/files': {
        get: {
          operationId: 'listFiles',
          summary: 'List files and folders at a path',
          parameters: [
            { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'path', in: 'query', schema: { type: 'string' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Directory listing' } },
        },
      },
      '/api/repos/{owner}/{repo}/file': {
        get: {
          operationId: 'readFile',
          summary: 'Read a file',
          parameters: [
            { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'path', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'File content' } },
        },
        put: {
          operationId: 'writeFile',
          summary: 'Create or update a file and commit it',
          parameters: [
            { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' } },
                  required: ['path', 'content'],
                },
              },
            },
          },
          responses: { '200': { description: 'Commit result' } },
        },
        delete: {
          operationId: 'deleteFile',
          summary: 'Delete a file and commit the deletion',
          parameters: [
            { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'path', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'message', in: 'query', schema: { type: 'string' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Deletion result' } },
        },
      },
      '/api/repos/{owner}/{repo}/commits': {
        get: {
          operationId: 'listCommits',
          summary: 'List recent commits',
          parameters: [
            { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'path', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'number' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Commit list' } },
        },
      },
    },
  }
}
