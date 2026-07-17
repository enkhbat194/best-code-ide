# BestCode PWA

BestCode бол GitHub-ийн repository/version-control боломжийг VS Code-тэй төстэй mobile editor, diff, build/test, deployment, preview болон approval workflow-той нэгтгэх mobile-first IDE.

```text
ChatGPT / MCP host
        ↓
BestCode Remote MCP Server
        ↓
Cloudflare Worker orchestrator
        ↓
GitHub repository / Actions / Cloudflare deployment
```

AI reasoning нь ChatGPT зэрэг MCP host дотор ажиллана. BestCode нь project/repository access, staged changes, user approval, Git delivery, CI task, deployment status болон PWA dashboard-ийг гүйцэтгэнэ. Legacy in-app AI chat default-оор унтарсан.

## Бүтэц

```text
frontend/   React + Vite PWA
             Files / Changes & Tasks / Preview / Settings

backend/    Cloudflare Worker
             Remote MCP / approval API / task API / GitHub API
             Durable Object approval and task storage

.github/    Validate / Test / Deploy workflows
```

## MCP tool-ууд

### Repository read

- `projects_list`
- `project_get`
- `repository_tree`
- `repository_read_file`
- `repository_read_files`
- `repository_search_code`
- `repository_get_branch`

### Staged change ба approval

- `repository_create_branch`
- `repository_write_file`
- `repository_apply_patch`
- `repository_delete_file`
- `repository_diff`
- `repository_status`
- `approval_get`

Write/patch/delete tool GitHub branch-ийг шууд өөрчлөхгүй. Base SHA, proposed content болон unified diff-ийг Durable Object-д `pending_approval` operation болгон хадгална. AI өөрийн operation-ийг approve хийж чадахгүй. Approve/Reject зөвхөн authenticated PWA/REST замаар хийгдэнэ.

### Approved Git delivery

- `repository_commit`
- `repository_push`
- `repository_create_pull_request`

`repository_commit` нь base SHA conflict шалгаад Git commit object бэлтгэнэ, branch ref өөрчлөхгүй. `repository_push` нь expected parent SHA-г шалгаад `force=false` fast-forward update хийнэ. Main/master руу delivery хийхгүй. Draft Pull Request-ийн өмнө configured build/test success шаардлагатай.

### Build, test, task

- `build_start`
- `build_status`
- `build_logs`
- `test_start`
- `test_status`
- `task_get`
- `task_cancel`
- `preview_get`

Build/test нь Cloudflare Worker дотор fake terminal ажиллуулахгүй. Worker GitHub Actions workflow dispatch хийгээд durable `task_id` хадгална. Status, run URL, conclusion, bounded paginated log болон cancellation-ийг GitHub API-аас авна.

### Production deployment

- `deployment_start`
- `deployment_status`
- `deployment_logs`

`deployment_start` хоёр шаттай:

1. `approval_operation_id`-гүй дуудвал production deployment хийхгүй, харин `purpose=deployment`, `risk=high`, `production_deployment` reason бүхий pending approval үүсгэнэ.
2. Хэрэглэгч PWA дээр approve хийсний дараа ижил tool-ийг approval ID-тай дахин дуудна.
3. Approval project, default branch, target-тай таарч байвал configured `deployWorkflow` dispatch хийнэ.
4. Durable deployment task ID үүсгэж status/log буцаана.

Deployment зөвхөн project-ийн default branch-аас эхэлнэ. `backend`, `frontend`, `all` target дэмжинэ. Deployment operation нэг цагийн дараа approve хийгдээгүй бол expired болно.

## Үндсэн workflow

```text
main
→ repository_create_branch(agent/<task>)
→ repository_tree/search/read
→ repository_write_file эсвэл repository_apply_patch
→ pending code approval
→ PWA дээр diff/risk шалгах
→ Approve
→ repository_commit
→ repository_push
→ build_start + test_start
→ status/log
→ repository_create_pull_request
→ review/merge
→ deployment_start (approval request)
→ PWA дээр production approval
→ deployment_start (approved operation)
→ deployment_status/logs
```

## PWA

- **Files** — GitHub import, IndexedDB local workspace, CodeMirror editor
- **Approval** — editor change болон production deployment request-ийг approve/reject хийх
- **Changes & Tasks** — diff, risk, build/test/deployment status/log/cancel
- **Preview** — local HTML/JS/TS preview
- **Settings** — backend URL, Bearer token, owner/repo/branch

Legacy Chat tab UI-аас хасагдсан. `/api/chat` нь `ENABLE_LEGACY_AGENT=true` тохиргоогүй үед HTTP 410 буцаана.

## Project registry

Зөвхөн `PROJECTS_JSON` доторх project ID ашиглана.

```json
[
  {
    "id": "bestcode",
    "name": "BestCode PWA",
    "owner": "enkhbat194",
    "repo": "best-code-ide",
    "defaultBranch": "main",
    "buildWorkflow": "validate.yml",
    "testWorkflow": "test.yml",
    "deployWorkflow": "deploy.yml",
    "previewUrl": "https://example.workers.dev"
  },
  {
    "id": "czech-app",
    "name": "Czech–Mongolian App",
    "owner": "enkhbat194",
    "repo": "czech-mongolian-app",
    "defaultBranch": "main",
    "buildWorkflow": "validate.yml",
    "testWorkflow": "test.yml",
    "deployWorkflow": "deploy.yml"
  }
]
```

Workflow эсвэл preview URL тохируулаагүй үед BestCode зохиомол үр дүн буцаахгүй.

## Cloudflare ба GitHub deployment configuration

Backend Worker configuration:

```bash
cd backend
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put PROJECTS_JSON
npx wrangler secret put MCP_ALLOWED_ORIGINS
npx wrangler deploy
```

GitHub repository/environment secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

`.github/workflows/deploy.yml` нь `production` GitHub Environment ашиглана. Environment protection rule нэмбэл GitHub талд мөн нэмэлт manual approval шаардаж болно. Secret байхгүй үед workflow бодит failure гаргана; fake success буцаахгүй.

Анхаарах зүйл: deploy хийх Worker нэр болон destination нь `backend/wrangler.toml`, `frontend/wrangler.toml`-оос ирнэ. Production эхлүүлэхээс өмнө эдгээр нэр одоогийн Cloudflare Worker-уудтай таарч байгааг шалгана.

## Security

- GitHub/Cloudflare token frontend рүү дамжихгүй.
- `/mcp`, REST, PWA backend request Bearer `AUTH_TOKEN` шаарддаг.
- Project allowlist ашиглана.
- Browser-origin MCP request allowlist шалгана.
- Public health endpoint secret/binding мэдээлэл задруулахгүй.
- Unified patch exact context таарахгүй бол operation үүсэхгүй.
- Approval response бүтэн base/proposed content буцаахгүй.
- Commit preparation ба branch push тусдаа.
- Force push ашиглахгүй.
- Base SHA/branch parent conflict илэрвэл delivery зогсоно.
- Pull Request-ийн өмнө build/test success шаардлагатай.
- Production deployment нь code-change approval-аас тусдаа high-risk approval шаарддаг.
- Legacy direct REST write болон in-app agent default-оор disabled.

Одоогийн Bearer authentication нь single-user prototype. OAuth, per-user identity, replay protection, rate limiting болон бүрэн audit timeline дараагийн security phase-д орно.

## GitHub permission

- Metadata: Read
- Contents: Read and write
- Actions: Read and write
- Pull requests: Read and write

## Automated checks

`.github/workflows/validate.yml`:

- frontend lint;
- frontend production build;
- backend TypeScript typecheck.

`.github/workflows/test.yml`:

- backend unit tests;
- unified patch apply/context/path/create/delete behavior.

`.github/workflows/deploy.yml`:

- manual `workflow_dispatch` only;
- production environment;
- Cloudflare secret validation;
- backend and/or frontend deployment.

## Одоогийн хязгаар

- MCP OAuth болон олон хэрэглэгчийн permission байхгүй.
- Rate limiting, replay protection, full durable audit timeline дараагийн шатанд орно.
- Remote React/Vite/Next preview runner байхгүй; `preview_get` configured URL л буцаана.
- GitHub code search нь indexed default branch дээр ажиллана.
- Local preview npm package import бүрэн дэмждэггүй.
