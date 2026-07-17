# BestCode production deployment

## Architecture

```text
ChatGPT Action or MCP host
→ deployment_start (approval request only)
→ BestCode Changes screen: Approve
→ deployment_start (approved operation ID)
→ GitHub Actions deploy.yml
→ Cloudflare Workers
```

The first `deployment_start` call never deploys. It creates a high-risk approval with no code changes. The approved operation is bound to one project, the project default branch, and one target: `backend`, `frontend`, or `all`.

## Required GitHub configuration

Create repository or `production` environment secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Recommended Cloudflare API token permissions:

```text
Account / Workers Scripts / Edit
Account / Account Settings / Read
```

The workflow uses the GitHub `production` environment. Add required reviewers to that environment when a second GitHub-side approval is desired.

## Project registry

The BestCode project entry must contain:

```json
{
  "id": "bestcode",
  "name": "BestCode PWA",
  "owner": "enkhbat194",
  "repo": "best-code-ide",
  "defaultBranch": "main",
  "buildWorkflow": "validate.yml",
  "testWorkflow": "test.yml",
  "deployWorkflow": "deploy.yml"
}
```

## Cloudflare destinations

Backend Worker name comes from `backend/wrangler.toml`:

```text
best-code-ide
```

Frontend Worker name comes from `frontend/wrangler.toml`:

```text
best-code-ide-app
```

Verify these names in Cloudflare before the first production deployment. Deployment status is taken from the actual GitHub Actions run; missing secrets or Cloudflare failures are returned as real failures.

## First backend deployment

1. Merge the reviewed deployment tooling PR into `main`.
2. Add the two Cloudflare secrets to GitHub.
3. Import the updated `/openapi.json` into the Custom GPT.
4. Call `deployment_start` with:

```json
{
  "project_id": "bestcode",
  "branch": "main",
  "target": "backend"
}
```

5. Approve the generated operation in BestCode.
6. Call `deployment_start` again with the same fields plus `approval_operation_id`.
7. Poll `deployment_status`, then inspect `deployment_logs`.
8. Verify `/health` returns build `openapi-actions-v1` or a newer build marker and re-import the schema.
