# BestCode PWA

BestCode бол GitHub-ийн repository/version-control боломжийг VS Code-тэй төстэй mobile editor, diff, validation, preview болон approval workflow-той нэгтгэх mobile-first IDE төсөл.

```text
ChatGPT / MCP host
        ↓
BestCode Remote MCP Server
        ↓
Cloudflare Worker orchestrator
        ↓
GitHub repository / Actions / deployment
```

AI reasoning нь ChatGPT зэрэг MCP host дотор ажиллана. BestCode нь project/repository access, staged changes, approval, Git operation, build/test status болон preview-г гүйцэтгэх tool layer байна.

## Одоогийн бүтэц

```text
frontend/   React + Vite PWA
             Files / Changes / Approval / Preview / Settings

backend/    Cloudflare Worker
             Remote MCP / REST / GitHub API / Durable Object approval store

.github/    GitHub Actions validation workflow
```

## Frontend stack

- React 19
- Vite 8
- TypeScript
- CodeMirror
- LightningFS / IndexedDB local workspace
- esbuild-wasm local preview
- Zustand
- vite-plugin-pwa

## Backend stack

- Cloudflare Workers
- TypeScript
- GitHub REST and Git Data APIs
- Stateless JSON-response Streamable HTTP MCP endpoint
- Durable Objects approval operation storage
- GitHub Actions validation

## MCP repository tools

### Read-only

- `projects_list`
- `project_get`
- `repository_tree`
- `repository_read_file`
- `repository_read_files`
- `repository_search_code`
- `repository_get_branch`

### Safe staged write

- `repository_create_branch`
- `repository_write_file`
- `repository_apply_patch`
- `repository_delete_file`
- `repository_diff`
- `repository_status`
- `approval_get`

`repository_write_file`, `repository_apply_patch`, `repository_delete_file` нь GitHub-д шууд commit/push хийхгүй. Эдгээр tool:

1. branch-ийн бодит файлыг уншина;
2. base SHA хадгална;
3. proposed content болон unified diff үүсгэнэ;
4. Durable Object-д `pending_approval` operation хадгална;
5. `operation_id`, risk, diff болон approval шаардлагыг ChatGPT-д буцаана.

AI өөрийн operation-ийг approve хийх tool авахгүй. Approve/Reject шийдвэр зөвхөн authenticated BestCode PWA/REST замаар хийгдэнэ.

## Approval workflow

```text
main
→ repository_create_branch(agent/<task>)
→ read/search files
→ write_file эсвэл apply_patch
→ pending approval operation
→ PWA Changes дээр diff/risk харах
→ Approve эсвэл Reject
→ approved operation
→ дараагийн Git Delivery phase-д commit/push/PR
```

Approval operation 24 цагийн дараа ашиглагдаагүй бол `expired` болно. Workflow, dependency/configuration, database/migration, sensitive path болон delete operation өндөр эрсдэлтэй гэж тэмдэглэгдэнэ.

## PWA

- **Files** — local workspace, CodeMirror editor, GitHub import
- **Approval** товч — local editor-ийн өөрчлөлтийг шууд commit хийхгүйгээр approval-д оруулна
- **Changes** — pending operation, exact diff, risk reason, Approve/Reject
- **Branch diff** — committed working branch болон main-ийн ялгаа
- **Validation** — frontend lint/build, backend typecheck
- **Draft PR** — existing committed branch-аас PR үүсгэх legacy control

## Project registry

MCP owner/repository-г дур мэдэн ашиглахгүй. Зөвхөн `PROJECTS_JSON` доторх төслүүдэд хүрнэ.

```json
[
  {
    "id": "bestcode",
    "name": "BestCode PWA",
    "owner": "enkhbat194",
    "repo": "best-code-ide",
    "defaultBranch": "main",
    "description": "BestCode mobile repository controller"
  },
  {
    "id": "czech-app",
    "name": "Czech–Mongolian App",
    "owner": "enkhbat194",
    "repo": "czech-mongolian-app",
    "defaultBranch": "main"
  }
]
```

`PROJECTS_JSON` байхгүй үед `bestcode` төсөл fallback registry болж ашиглагдана.

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

`wrangler.toml` нь `APPROVALS` Durable Object binding болон `approval-store-v1` migration агуулна. Анхны deploy хийх үед Cloudflare Durable Object class/storage үүсгэнэ.

Legacy PWA chat-ийг түр хадгалах бол:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

## Authentication ба security

- GitHub token frontend рүү дамжихгүй.
- GitHub token болон project registry Cloudflare configuration-д байна.
- `/mcp`, REST болон PWA backend request Bearer `AUTH_TOKEN` шаарддаг.
- Browser-origin MCP request allowlist шалгана.
- Health endpoint secret/binding мэдээлэл задруулахгүй.
- MCP tool call structured log-д `operation_id`, tool, duration, status бичигдэнэ.
- `main/master` дээр staged write, direct editor commit болон agent commit хоригтой.
- Unified patch exact context таарахгүй бол operation үүсэхгүй.
- Approval API бүтэн base/proposed file content буцаахгүй; bounded diff болон metadata л буцаана.

Одоогийн authentication нь single-user Bearer prototype. OAuth, per-user identity, replay protection болон rate limiting дараагийн security phase-д орно.

## GitHub permission

- Metadata: Read
- Contents: Read and write
- Actions: Read and write
- Pull requests: Read and write

Phase 3 staged write нь approval хүртэл GitHub content өөрчилдөггүй. `repository_create_branch` л working branch ref үүсгэнэ.

## Validation

`.github/workflows/validate.yml`:

- frontend lint;
- frontend production build;
- backend TypeScript typecheck.

## Одоогийн хязгаар

- Approved operation-ийг commit/push болгох MCP tool хараахан нэмэгдээгүй.
- Test workflow нь build/lint/typecheck-ээс тусдаа болоогүй.
- Production deployment trigger/status байхгүй.
- Remote React/Vite/Next preview runner байхгүй.
- Full audit history, OAuth, rate limiting, replay protection дараагийн шатанд орно.
- GitHub code search GitHub-ийн indexed default branch дээр ажиллана.

## Дараагийн шат

```text
approved operation
→ base SHA conflict check
→ one atomic commit
→ validation build/test
→ commit/push result
→ Pull Request
```

Дараагийн багц нь `repository_commit`, `repository_push`, `repository_create_pull_request`, build/test task status/log болон approved operation delivery-г хэрэгжүүлнэ.
