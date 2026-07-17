# BestCode PWA

BestCode бол GitHub-ийн repository/version-control боломжийг VS Code-тэй төстэй mobile editor, diff, validation, preview болон task workflow-той нэгтгэх mobile-first IDE төсөл.

Зорилтот урсгал:

```text
ChatGPT / MCP host
        ↓
BestCode Remote MCP Server
        ↓
Cloudflare Worker orchestrator
        ↓
GitHub repository / Actions / deployment
```

AI reasoning нь ChatGPT зэрэг MCP host дотор ажиллана. BestCode Worker нь project access, repository access, Git operation, build/test trigger, status/log болон approval-ийг гүйцэтгэх tool layer байна.

## Одоогийн бүтэц

```text
frontend/   React + Vite PWA
            Chat / Files / Changes / Preview / Settings

backend/    Cloudflare Worker
            REST / legacy in-app agent / Remote MCP / GitHub API

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
- Stateless Streamable HTTP MCP endpoint
- GitHub Actions build validation

## Phase 2 — Read-only MCP

`/mcp` endpoint одоогоор MCP client-д зөвхөн read-only tools гаргана:

- `projects_list`
- `project_get`
- `repository_tree`
- `repository_read_file`
- `repository_read_files`
- `repository_search_code`
- `repository_get_branch`

Tool бүр:

- JSON Schema input/output;
- `readOnlyHint=true` annotation;
- structured JSON result;
- `operation_id`;
- project/repository/branch context;
- bounded output болон cursor pagination;
- бодит error code, retryable төлөв, хэрэглэгчийн шаардлагатай үйлдэл;

буцаана.

MCP нь project ID ашигладаг. ChatGPT owner/repo-г дур мэдэн оруулж токены бүх repository-д хүрэхгүй. Зөвхөн project registry-д байгаа repository ашиглагдана.

## Project registry

`PROJECTS_JSON` тохиргооны жишээ:

```json
[
  {
    "id": "bestcode",
    "name": "BestCode PWA",
    "owner": "enkhbat194",
    "repo": "best-code-ide",
    "defaultBranch": "main",
    "description": "BestCode mobile repository controller"
  }
]
```

`PROJECTS_JSON` байхгүй үед одоогийн `bestcode` төсөл fallback registry болж ашиглагдана. Олон project нэмж эхлэх үед Cloudflare secret/variable хэлбэрээр тохируулна.

## Cloudflare secrets/configuration

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

Legacy PWA chat-ийг түр хадгалах бол:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

`MCP_ALLOWED_ORIGINS` нь comma-separated trusted origins байна. Origin header байхгүй server-to-server MCP request зөвшөөрөгдөнө. Browser-origin request зөвхөн allowlist-д байвал ажиллана.

## Authentication

- GitHub token frontend рүү дамжихгүй.
- GitHub token болон project registry Cloudflare configuration-д байна.
- `/mcp`, REST болон PWA backend request Bearer `AUTH_TOKEN` шаарддаг.
- Health endpoint secret нэр, төлөв болон binding жагсаалт задруулахгүй.
- MCP tool дуудлага Cloudflare structured log-д `operation_id`, tool name, duration, success/failure төлөвөөр бүртгэгдэнэ.

OAuth, user identity, per-user permission болон D1 audit history нь дараагийн security phase-д орно.

## GitHub permissions

Phase 2 read-only MCP-д minimum permission:

- Metadata: Read
- Contents: Read

Legacy PWA write, branch, Actions болон PR боломжийг хадгалах бол нэмэлтээр:

- Contents: Read and write
- Actions: Read and write
- Pull requests: Read and write

## Main branch хамгаалалт

- MCP Phase 2 нь write tool огт гаргахгүй.
- In-app agent-ийн write/delete/atomic commit `main/master` дээр хориглогдсон.
- Legacy Files → Push endpoint мөн `main/master` дээр HTTP 409 буцаана.
- Том өөрчлөлт working branch дээр хийгдэнэ.

## Validation

`.github/workflows/validate.yml` дараах шалгалтыг ажиллуулна:

- frontend lint;
- frontend production build;
- backend TypeScript typecheck.

## Одоогийн хязгаар

- MCP Phase 2 read-only; approval/write tools дараагийн phase-д орно.
- Bearer token нь single-user prototype authentication; OAuth биш.
- Durable task storage, approval history, rate limiting болон replay protection хараахан байхгүй.
- GitHub code search нь GitHub-ийн indexed default branch дээр ажиллана.
- Local preview npm package import бүрэн дэмждэггүй.
- Production deployment workflow болон remote preview runner тусдаа нэмэгдэнэ.

## Дараагийн үе шат

Phase 3:

```text
working branch
→ proposed patch
→ stored change set
→ diff
→ approval request
→ approved commit/push
```

Үүнд `repository_create_branch`, `repository_apply_patch`, `repository_status`, `repository_diff` болон approval system нэмэгдэнэ. Main branch руу шууд write хийх боломж нээгдэхгүй.
