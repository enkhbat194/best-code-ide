# BestCode production deployment

> **P0 integrity status (verified 2026-07-19):** The original non-main production exposure was found and repaired by provider-level evidence. A deliberate non-main probe subsequently stayed preview-only while production remained on exact `main`, and an owner-approved backend/PWA rollback→smoke→restore→smoke drill passed. Every release still confirms active branch/SHA dynamically; version history alone is never accepted as production truth.

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

The first `deployment_start` call never deploys. It creates a high-risk approval with no code changes. The approved operation is bound to one project, the project default branch, one exact source SHA, and one target: `backend`, `frontend`, or `all`. If `main` moves before execution, the operation becomes `superseded`; no workflow dispatch occurs and a new approval is required.

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
version, ancestry, build source, traffic ба smoke contract-ийг тусдаа rollback controller
шалгана.

## Previous-good rollback controller

`.github/workflows/rollback-rehearsal.yml` нь `main` push бүрийн дараа хоёр Worker-д
mutation хийхгүй `plan` үүсгэнэ. `scripts/cloudflare-rollback-controller.mjs`:

1. active deployment яг нэг version-д 100% traffic өгч, exact current `main` SHA-аас
   build хийгдсэнийг шалгана;
2. deployment history дотроос preview upload болон failed build-ийг хасна;
3. GitHub compare API-аар current `main`-ийн бодит ancestor мөн болох хамгийн шинэ
   previous-good production version-ийг сонгоно;
4. current/candidate version, commit SHA, build UUID-г redacted JSON artifact болгоно.

`rehearse` нь production traffic-д бодит өөрчлөлт хийдэг тул high-risk owner decision.
Дараах дөрвөн утга нэгэн зэрэг яг таарахгүй бол controller mutation хийхгүй:

- owner сонгосон Worker;
- latest plan-ийн candidate version ID;
- latest plan-ийн candidate full commit SHA;
- literal confirmation `REHEARSE_ROLLBACK`.

Таарсан үед controller candidate version-д 100% traffic түр идэвхжүүлж smoke хийгээд,
амжилттай эсэхээс үл хамааран `finally` хамгаалалтаар эхний current version-ийг 100%
traffic-т буцааж, restore smoke хийнэ. Cloudflare-ийн documented `force=true` query-г
зөвхөн дээрх exact previous-good saved version ID-г идэвхжүүлэхэд хэрэглэнэ; энэ нь
secret/binding өөрчлөгдсөн үед older version deployment-ийг API блоклосныг owner-ийн
exact approval-аар давуулах зориулалттай бөгөөд candidate selection эсвэл concurrent
deployment guard-ийг сулруулахгүй. Rehearsal evidence
нь rollback/restore deployment ID, active болсон version, smoke status-ийг хадгална,
secret болон environment value хадгалахгүй. Restore хийхийн өмнө active version-ийг
дахин уншина; энэ хооронд өөр deployment орсон бол түүнийг хуучин version-оор
дарж бичихгүй, rehearsal-ийг concurrency incident гэж failure болгоно.

First owner-approved production drill evidence:

- run `29683440382`;
- artifact `rollback-rehearsal-approved-29683440382-1`, ID `8441302013`;
- digest `sha256:9139cd1b05a47dfedf674e383126a5cf45508395178f6535a2c2e1566981892f`;
- backend болон PWA rollback/restore smoke бүр HTTP 200;
- evidence records: `ok=true`, `restored=true`, error=null.

Cloudflare Create Deployment API reference:
<https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/>.

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
