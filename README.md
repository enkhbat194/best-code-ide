# BestCode PWA

BestCode бол GitHub-ийн repository/version-control боломжийг VS Code-тэй төстэй mobile editor, diff, build/test, preview болон approval workflow-той нэгтгэх mobile-first IDE.

```text
ChatGPT / MCP host
        ↓
BestCode Remote MCP Server
        ↓
Cloudflare Worker orchestrator
        ↓
GitHub repository / Actions
```

AI reasoning нь ChatGPT зэрэг MCP host дотор ажиллана. BestCode нь project/repository access, staged changes, approval, Git delivery, build/test task болон PWA dashboard-ийг гүйцэтгэнэ. Legacy in-app DeepSeek chat default-оор унтарсан.

## Одоогийн бүтэц

```text
frontend/   React + Vite PWA
             Files / Changes & Tasks / Preview / Settings

backend/    Cloudflare Worker
             Remote MCP / approval API / task API / GitHub API
             Durable Object approval and task storage

.github/    Validate + Test workflows
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

Write/patch/delete tool нь GitHub branch-ийг өөрчлөхгүй. Бодит файл, base SHA, proposed content болон unified diff-ийг Durable Object-д `pending_approval` operation болгон хадгална. AI өөрийн operation-ийг approve хийж чадахгүй. Approve/Reject зөвхөн authenticated PWA/REST замаар хийгдэнэ.

### Approved Git delivery

- `repository_commit`
- `repository_push`
- `repository_create_pull_request`

`repository_commit`:

1. operation үнэхээр approved эсэхийг шалгана;
2. staged файл бүрийн base SHA одоогийн branch-тэй таарч байгаа эсэхийг шалгана;
3. Git blob/tree/commit object үүсгэнэ;
4. branch ref-ийг өөрчлөхгүй;
5. operation-ийг `commit_prepared` болгоно.

`repository_push`:

1. branch `main/master` бишийг шалгана;
2. branch head prepared commit-ийн expected parent-тэй таарч байгаа эсэхийг шалгана;
3. `force=false` fast-forward update хийнэ;
4. operation-ийг `pushed` болгоно.

`repository_create_pull_request` нь configured build болон test task амжилттай болсон үед draft PR үүсгэнэ.

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

## Зөв workflow

```text
main
→ repository_create_branch(agent/<task>)
→ repository_tree/search/read
→ repository_write_file эсвэл repository_apply_patch
→ pending_approval
→ PWA Changes дээр exact diff/risk шалгах
→ Approve
→ repository_commit
→ repository_push
→ build_start + test_start
→ build_status/test_status + logs
→ repository_create_pull_request
```

Main/master руу write, commit, push хийх боломж нээгдэхгүй.

## PWA

- **Files** — GitHub import, IndexedDB local workspace, CodeMirror editor
- **Approval** — editor өөрчлөлтийг шууд commit хийхгүйгээр pending approval болгоно
- **Changes & Tasks** — diff, risk, Approve/Reject, build/test start/status/log/cancel
- **Preview** — local HTML/JS/TS preview
- **Settings** — backend URL, Bearer token, owner/repo/branch

Legacy Chat tab UI-аас хасагдсан. `/api/chat` нь `ENABLE_LEGACY_AGENT=true` тохиргоогүй үед HTTP 410 буцаана.

## Project registry

ChatGPT owner/repo-г дур мэдэн ашиглахгүй. Зөвхөн `PROJECTS_JSON` доторх project ID ашиглана.

```json
[
  {
    "id": "bestcode",
    "name": "BestCode PWA",
    "owner": "enkhbat194",
    "repo": "best-code-ide",
    "defaultBranch": "main",
    "description": "BestCode repository controller",
    "buildWorkflow": "validate.yml",
    "testWorkflow": "test.yml",
    "previewUrl": "https://example.workers.dev"
  },
  {
    "id": "czech-app",
    "name": "Czech–Mongolian App",
    "owner": "enkhbat194",
    "repo": "czech-mongolian-app",
    "defaultBranch": "main",
    "buildWorkflow": "validate.yml",
    "testWorkflow": "test.yml"
  }
]
```

`buildWorkflow`, `testWorkflow`, `deployWorkflow`, `previewUrl` optional. Tool нь байхгүй workflow эсвэл preview URL-ийг зохиомлоор буцаахгүй.

## Cloudflare configuration

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

`wrangler.toml` нь `APPROVALS` Durable Object binding болон `approval-store-v1` migration агуулна.

Legacy agent-ийг зөвхөн түр сэргээх шаардлагатай үед:

```text
ENABLE_LEGACY_AGENT=true
ENABLE_LEGACY_REST_WRITES=true
```

Эдгээр flag-ийг production-д default-оор бүү асаа. Legacy REST read endpoint-ууд ажиллана, direct write/branch/PR endpoint-ууд flag байхгүй үед HTTP 410 буцаана.

## Security

- GitHub token frontend рүү дамжихгүй.
- `/mcp`, REST болон PWA backend request Bearer `AUTH_TOKEN` шаарддаг.
- Project allowlist ашиглана.
- Browser-origin MCP request allowlist шалгана.
- Public health endpoint secret/binding мэдээлэл задруулахгүй.
- Unified patch exact context таарахгүй бол operation үүсэхгүй.
- Approval response бүтэн base/proposed content буцаахгүй; bounded diff ба metadata буцаана.
- Prepared commit ба branch push тусдаа operation.
- Force push ашиглахгүй.
- Base SHA болон branch parent conflict илэрвэл delivery зогсоно.
- Pull Request-ийн өмнө build/test success шаардлагатай.

Одоогийн Bearer authentication нь single-user prototype. OAuth, per-user identity, replay protection, rate limiting болон бүрэн audit history дараагийн security phase-д орно.

## GitHub permission

- Metadata: Read
- Contents: Read and write
- Actions: Read and write
- Pull requests: Read and write

## Validation ба test

`.github/workflows/validate.yml`:

- frontend lint;
- frontend production build;
- backend TypeScript typecheck.

`.github/workflows/test.yml`:

- backend unit tests;
- unified patch apply/context/path/create/delete behavior.

## Одоогийн хязгаар

- Production deployment trigger/status approval flow хараахан нэмэгдээгүй.
- Remote React/Vite/Next preview runner байхгүй; `preview_get` зөвхөн configured URL буцаана.
- MCP OAuth болон олон хэрэглэгчийн permission байхгүй.
- Rate limiting, replay protection, full durable audit timeline дараагийн шатанд орно.
- GitHub code search нь GitHub-ийн indexed default branch дээр ажиллана.
- Local preview npm package import бүрэн дэмждэггүй.
