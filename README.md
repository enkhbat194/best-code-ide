# BestCode — Personal Creation OS

BestCode бол Enkhbat-д зориулсан private, mobile-first AI инженерчлэл ба бүтээлийн орчин. Хэрэглэгч утсаараа монголоор зорилгоо хэлэхэд BestCode судалгаа, төлөвлөгөө, бүтээл, шалгалт, approval, release болон дахин ашиглагдах asset хүртэлх урсгалыг нэг зорилго, нэг санах ой, нэг policy/evidence системээр удирдана.

Одоогийн production foundation нь software/repository workflow дээр ажиллана. Web Research Agent, Second Brain v2, Asset Graph, semantic approval, remote runner болон real-world creation mode нь Master v2-ийн дараалсан **target** capability; production дээр байгаа мэтээр тайлагнахгүй.

```text
ChatGPT / Claude / DeepSeek / future AI roles
                    │
                    v
BestCode PWA → Worker Policy/Evidence Gate → Project Brain / GitHub / CI
                    │
                    └─ Target: Mission / Research / Runner / Asset Graph
```

- **AI provider-ууд** — Planner, Builder, Researcher, Reviewer зэрэг role авч болно; canonical state эзэмшихгүй.
- **BestCode PWA** — owner-ийн Mission, workspace, Preview, evidence, approval, Asset-ийн mobile интерфэйс.
- **BestCode Worker** — бүх AI-д ижил project, capability, security, task, approval, Git болон evidence дүрэм хэрэгжүүлэх controller.
- **GitHub `main`** — software code/config-ийн эхний source of truth.

Canonical зорилго, AI role, Research/Asset чиглэл болон ажлын хатуу дүрэм: [`BESTCODE_MASTER.md`](BESTCODE_MASTER.md) v2.0.0.

Implementation guides:

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — detailed work packages and exit evidence;
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current/target layered architecture;
- [`docs/RESEARCH_POLICY.md`](docs/RESEARCH_POLICY.md) — safe web research and claim provenance;
- [`docs/EVIDENCE_STANDARD.md`](docs/EVIDENCE_STANDARD.md) — evidence, semantic approval, rollback;
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — current-state threats and security gates;
- [`docs/PRODUCT_BENCHMARK.md`](docs/PRODUCT_BENCHMARK.md) — Cursor/Replit/VS Code/Codex strategic benchmark.

## Одоогийн бүтэц

```text
frontend/   React + Vite PWA
             Chat / Files / Changes & Tasks / Preview / Settings

backend/    Cloudflare Worker
             Remote MCP / Custom GPT Actions / AI chat
             Project Brain / approval / task / GitHub API
             Durable Object task, handoff and approval storage

.github/    Validate + Test workflows
```

## Project Brain

Бүх connected AI нэг баталгаатай context, task lifecycle болон handoff ашиглана. Нэг AI-ийн chat санах ой нь төслийн үнэн гэж тооцогдохгүй.

Canonical memory нь GitHub `main` дээр байна:

- `BESTCODE_MASTER.md` — locked зорилго, үүрэг, дүрэм;
- `docs/PROJECT_STATUS.md` — одоогийн бодит төлөв;
- `docs/ARCHITECTURE.md` — системийн урсгал;
- `docs/ROADMAP.md` — ажлын дараалал;
- `docs/DECISIONS/` — шийдвэрийн хувилбарын түүх;
- `docs/RESEARCH_POLICY.md`, `docs/EVIDENCE_STANDARD.md`, `docs/THREAT_MODEL.md` — түгжсэн operating contract.

Dynamic memory нь Durable Object-д project тус бүрээр task, handoff, approval болон workflow evidence хадгална. Энэ metadata нь GitHub/CI/deployment-ийн нотолгоог орлохгүй.

Project Brain tool-ууд:

- `project_context_get`, `project_memory_search`;
- `project_task_start`, `project_task_list`, `project_task_get`, `project_task_update`;
- `project_handoff_record`, `project_handoff_list`.

## ChatGPT Custom GPT Actions

Custom GPT → Configure → Actions → Import from URL:

```text
https://best-code-ide.enkhbat194.workers.dev/openapi.json
```

Authentication:

```text
Authentication type: API Key
Auth type: Bearer
API key: Cloudflare AUTH_TOKEN-ийн яг утга
```

OpenAPI schema нь MCP tool-уудын input schema-аас автоматаар үүснэ. Custom GPT Actions болон MCP нь нэг executor ашигладаг тул project allowlist, approval, main/master хамгаалалт, conflict check, build/test дүрэм ижил байна.

Эхний шалгалт:

```text
projects_list
→ project_context_get
→ project_task_start
→ repository_tree
→ repository_read_file
```

Coding workflow:

```text
project_context_get
→ repository_create_branch
→ repository_write_file эсвэл repository_apply_patch
→ pending_approval
→ BestCode PWA дээр Approve
→ repository_commit
→ repository_push
→ build_start + test_start
→ status/logs
→ repository_create_pull_request
→ merge/deploy evidence
→ project_task_update + project_handoff_record
```

Custom GPT-д approval шийдвэр гаргах action өгдөггүй. Approve/Reject нь зөвхөн BestCode PWA/approval REST UI-аар хийгдэнэ.

## MCP tool-ууд

### Project Brain

- `project_context_get`
- `project_memory_search`
- `project_task_start`, `project_task_list`, `project_task_get`, `project_task_update`
- `project_handoff_record`, `project_handoff_list`

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

Write/patch/delete tool нь GitHub branch-ийг өөрчлөхгүй. Бодит файл, base SHA, proposed content болон unified diff-ийг Durable Object-д `pending_approval` operation болгон хадгална. AI өөрийн operation-ийг approve хийж чадахгүй.

### Approved Git delivery

- `repository_commit`
- `repository_push`
- `repository_create_pull_request`

`repository_commit`:

1. operation approved эсэхийг шалгана;
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

## PWA

- **Chat** — local workspace-focused DeepSeek coding туслах
- **Files** — GitHub import, IndexedDB local workspace, CodeMirror editor
- **Approval** — editor өөрчлөлтийг шууд commit хийхгүйгээр pending approval болгоно
- **Changes & Tasks** — diff, risk, Approve/Reject, build/test start/status/log/cancel
- **Preview** — local HTML/JS/TS preview болон UI-side console capture
- **Settings** — backend URL, Bearer token, owner/repo/branch

Одоогийн PWA Chat нь `/api/llm` DeepSeek loop ашиглана. Repository-aware `/api/chat` backend route байгаа боловч UI-д хараахан холбогдоогүй. Preview diagnostics мөн external AI tool руу хараахан дамжихгүй; энэ нь дараагийн тусдаа ажлын багц.

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
    "previewUrl": "https://best-code-ide-appl.enkhbat194.workers.dev",
    "memoryPaths": [
      "BESTCODE_MASTER.md",
      "docs/PROJECT_STATUS.md",
      "docs/ARCHITECTURE.md",
      "docs/ROADMAP.md",
      "docs/RESEARCH_POLICY.md",
      "docs/EVIDENCE_STANDARD.md",
      "docs/THREAT_MODEL.md",
      "docs/PRODUCT_BENCHMARK.md",
      "docs/DECISIONS/README.md",
      "docs/DECISIONS/0001-project-brain-and-ai-roles.md",
      "docs/DECISIONS/0002-personal-creation-os.md",
      "README.md"
    ]
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

`buildWorkflow`, `testWorkflow`, `deployWorkflow`, `previewUrl`, `memoryPaths` optional. `memoryPaths` өгөөгүй бол BestCode-ийн canonical default жагсаалтыг ашиглана. Tool нь байхгүй workflow, preview URL эсвэл memory файлыг зохиомлоор буцаахгүй.

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

`wrangler.toml` нь `APPROVALS` Durable Object binding болон migration агуулна.

Legacy direct REST write-ийг зөвхөн тусгай compatibility хэрэгцээнд:

```text
ENABLE_LEGACY_REST_WRITES=true
REQUIRE_APPROVALS=false
```

гэж хоёуланг нь зориудаар тохируулсан үед ашиглана. Production-д эдгээрийг бүү асаа. Safe default нь staged approval workflow.

## Security

- GitHub token frontend рүү дамжихгүй.
- `/mcp`, `/api/actions/*`, REST болон PWA backend request Bearer `AUTH_TOKEN` шаарддаг.
- Project allowlist ашиглана.
- Browser-origin MCP request allowlist шалгана.
- Public `/openapi.json` зөвхөн schema гаргана; secret агуулахгүй.
- Public health endpoint secret/binding мэдээлэл задруулахгүй.
- Unified patch exact context таарахгүй бол operation үүсэхгүй.
- Approval response бүтэн base/proposed content буцаахгүй; bounded diff ба metadata буцаана.
- Prepared commit ба branch push тусдаа operation.
- Force push ашиглахгүй.
- Base SHA болон branch parent conflict илэрвэл delivery зогсоно.
- Pull Request-ийн өмнө build/test success шаардлагатай.
- AI approval decision action авахгүй.

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
- unified patch apply/context/path/create/delete behavior;
- Project Brain context, search, task lifecycle, handoff болон canonical-memory risk behavior.

## Одоогийн хязгаар

- OpenAPI Actions schema deploy хийсний дараа ChatGPT editor дээр бодитоор import/test хийх шаардлагатай.
- Claude MCP production connection-ийг end-to-end host дээр баталгаажуулах шаардлагатай.
- PWA Chat одоогоор Project Brain/task tool-той шууд холбогдоогүй.
- Preview diagnostics external AI/DeepSeek tool руу очдоггүй.
- Coherent multi-file change set-д нэг approval болох UI/backend урсгал бүрэн дуусаагүй.
- Remote React/Vite/Next preview runner байхгүй; `preview_get` зөвхөн configured URL буцаана.
- MCP OAuth болон олон хэрэглэгчийн permission байхгүй.
- Rate limiting, replay protection, full durable audit timeline дараагийн шатанд орно.
- GitHub code search нь GitHub-ийн indexed default branch дээр ажиллана.
- Local preview npm package import бүрэн дэмждэггүй.
