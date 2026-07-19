# BestCode production deployment

> **P0 integrity notice (2026-07-19):** Cloudflare Git integration showed a non-main PR branch version in deployment history before merge, but BestCode did not persist enough branch/SHA/traffic evidence to prove whether that version received production traffic. Cloudflare's documented default is preview upload for non-production branches. Until Phase 2.1 verifies the actual trigger configuration and active source, every release must confirm active branch/SHA instead of inferring it from version history.

Master v2 rule `BC-R23`: non-main branch deployment must never receive production traffic. Required remediation and exit evidence are in `docs/ROADMAP.md` Phase 2.1A and `docs/EVIDENCE_STANDARD.md` Release evidence.

Official current behavior: <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>.

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
Account / Workers Builds Configuration / Edit
```

`Release Integrity` workflow нь token-ийг зөвхөн GitHub `production` environment-ээс
уншина. Evidence artifact-д token, build environment variables, build-token UUID
хадгалахгүй.

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

Canonical installed PWA Worker name comes from `frontend/wrangler.toml`:

```text
best-code-ide-appl
```

`best-code-ide-app` нь хуучин manual target. Шинэ workflow болон Wrangler config
installed `best-code-ide-appl.enkhbat194.workers.dev` target-ийг canonical production
frontend болгоно.

## Automated production source audit

`.github/workflows/release-integrity.yml` нь `main` push бүрийн дараа, зургаан цаг
тутам, мөн owner manual dispatch хийхэд дараах contract-ийг шалгана:

1. `best-code-ide` trigger root нь `backend`, `best-code-ide-appl` trigger root нь
   `frontend` байна.
2. Яг нэг production trigger `branch_includes: [main]`,
   `branch_excludes: []`, explicit `wrangler deploy` байна.
3. Optional preview trigger зөвхөн `branch_includes: ["*"]`,
   `branch_excludes: [main]`, explicit `wrangler versions upload` байна.
4. Active deployment яг нэг version-д 100% traffic өгсөн байна.
5. Active version-ийн Workers Build metadata branch=`main`, commit SHA=`GITHUB_SHA`,
   repository/root/deploy command contract-той таарна.

Cloudflare build GitHub push-ээс хойш асинхрон дуусдаг тул audit хуучин `main` SHA-г
15 минут хүртэл bounded poll хийнэ. Non-main active branch, unsafe trigger, split
traffic зэрэг integrity incident-ийг retry хийхгүй шууд failure болгоно. Run бүрийн
санитизац хийсэн JSON evidence `release-integrity-<run-id>` artifact болж 30 хоног
хадгалагдана.

`agent/source-lock-probe-*` branch нь зориудын non-main isolation rehearsal-д
зориулагдана. Тэр branch push хийхэд тусдаа job:

- хоёр Worker-ийн exact branch/SHA preview build олдсоныг;
- deploy command нь `wrangler versions upload` байсныг;
- тэр хугацаанд production active deployment одоогийн `main` SHA дээр 100% хэвээр
  үлдсэнийг нэг evidence record-д холбоно.

Probe branch-ийг production code-д merge хийхгүй; evidence гарсны дараа устгана.

Exact preview filter (`*` include, `main` exclude), expected repository/root таарсан мөртөө
production `wrangler deploy` command-тай trigger илэрвэл workflow command-ийг
`wrangler versions upload` болгон guarded auto-repair хийнэ. Өөр branch filter,
repository, root эсвэл production trigger-ийг автоматаар өөрчлөхгүй.

Active source mismatch дээр production traffic-ийг энэ audit шууд өөрчлөхгүй; latest
`main` push өөрөө production trigger-ээр source-ийг сэргээнэ. Exact previous-good
version, binding compatibility, smoke evidence бүрдсэн rollback controller дараагийн
тусдаа high-risk багц байна.

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
