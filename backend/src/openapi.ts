/** OpenAPI 3.1 schema for ChatGPT Custom GPT Actions and other REST clients. */
export function openapiSpec(origin: string): object {
  const ownerParam = { name: 'owner', in: 'path', required: true, schema: { type: 'string' } }
  const repoParam = { name: 'repo', in: 'path', required: true, schema: { type: 'string' } }
  const branchParam = { name: 'branch', in: 'query', schema: { type: 'string', default: 'main' } }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Best Code IDE Agent API',
      description: 'Inspect, search, edit, compare, validate, and manage GitHub repositories from AI chats.',
      version: '0.2.0',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    paths: {
      '/api/repos/{owner}/{repo}/tree': {
        get: {
          operationId: 'listRepositoryTree',
          summary: 'List the recursive repository tree',
          parameters: [ownerParam, repoParam, branchParam, { name: 'max_entries', in: 'query', schema: { type: 'integer', default: 500 } }],
          responses: { '200': { description: 'Repository tree' } },
        },
      },
      '/api/repos/{owner}/{repo}/search': {
        get: {
          operationId: 'searchRepositoryCode',
          summary: 'Search repository code by keyword, symbol, filename, or error text',
          parameters: [
            ownerParam,
            repoParam,
            branchParam,
            { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: { '200': { description: 'Code search matches' } },
        },
      },
      '/api/repos/{owner}/{repo}/files': {
        get: {
          operationId: 'listDirectory',
          summary: 'List files and folders at one path',
          parameters: [ownerParam, repoParam, branchParam, { name: 'path', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'Directory listing' } },
        },
      },
      '/api/repos/{owner}/{repo}/files/read': {
        post: {
          operationId: 'readMultipleFiles',
          summary: 'Read up to 12 related files in one request',
          parameters: [ownerParam, repoParam, branchParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { paths: { type: 'array', maxItems: 12, items: { type: 'string' } } },
                  required: ['paths'],
                },
              },
            },
          },
          responses: { '200': { description: 'File contents' } },
        },
      },
      '/api/repos/{owner}/{repo}/file': {
        get: {
          operationId: 'readFile',
          summary: 'Read one file',
          parameters: [ownerParam, repoParam, branchParam, { name: 'path', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'File content' } },
        },
        put: {
          operationId: 'writeFile',
          summary: 'Create or update a file and commit it to the selected branch',
          parameters: [ownerParam, repoParam, branchParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                    message: { type: 'string' },
                  },
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
            ownerParam,
            repoParam,
            branchParam,
            { name: 'path', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'message', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Deletion result' } },
        },
      },
      '/api/repos/{owner}/{repo}/branches': {
        get: {
          operationId: 'listBranches',
          summary: 'List repository branches',
          parameters: [ownerParam, repoParam, { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } }],
          responses: { '200': { description: 'Branch list' } },
        },
        post: {
          operationId: 'createWorkingBranch',
          summary: 'Create a working branch before editing main',
          parameters: [ownerParam, repoParam, branchParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, from: { type: 'string' } },
                  required: ['name'],
                },
              },
            },
          },
          responses: { '200': { description: 'Created branch' } },
        },
      },
      '/api/repos/{owner}/{repo}/compare': {
        get: {
          operationId: 'compareBranches',
          summary: 'Get unified diff between two branches',
          parameters: [
            ownerParam,
            repoParam,
            { name: 'base', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'head', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Unified diff' } },
        },
      },
      '/api/repos/{owner}/{repo}/commits': {
        get: {
          operationId: 'listCommits',
          summary: 'List recent commits',
          parameters: [
            ownerParam,
            repoParam,
            branchParam,
            { name: 'path', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
          ],
          responses: { '200': { description: 'Commit list' } },
        },
      },
      '/api/repos/{owner}/{repo}/validation': {
        post: {
          operationId: 'runValidation',
          summary: 'Start the validate.yml GitHub Actions workflow',
          parameters: [ownerParam, repoParam, branchParam],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { branch: { type: 'string' } } },
              },
            },
          },
          responses: { '200': { description: 'Validation dispatch result' } },
        },
        get: {
          operationId: 'getValidationStatus',
          summary: 'Get recent validation workflow runs',
          parameters: [ownerParam, repoParam, branchParam],
          responses: { '200': { description: 'Validation run status' } },
        },
      },
      '/api/repos': {
        post: {
          operationId: 'createRepository',
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
          responses: { '200': { description: 'Repository created' } },
        },
      },
    },
  }
}
