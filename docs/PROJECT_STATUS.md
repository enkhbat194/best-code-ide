# BestCode — Project Status

Last updated: 2026-07-19

Canonical plan: `/BESTCODE_MASTER.md` v2.0.0 (`LOCKED`)

## 1. Production source of truth

- Repository: `enkhbat194/best-code-ide`
- Default branch: `main`
- Dynamic Git truth: GitHub-ийн одоогийн `main` HEAD
- Runtime release truth: PWA `Settings → Release & Integrity` (`/api/release`)
- Backend: `https://best-code-ide.enkhbat194.workers.dev`
- Backend health contract: `/health` нь build болон Worker version metadata-г runtime дээр буцаана
- Installed PWA: `https://best-code-ide-appl.enkhbat194.workers.dev`
- PWA build contract: branch, commit SHA, Cloudflare build ID/time-г bundle-д embed хийнэ
- PWA update contract: service worker `skipWaiting` + `clientsClaim` ашиглан шинэ asset-ийг идэвхжүүлнэ
- Manual frontend target: `https://best-code-ide-app.enkhbat194.workers.dev`

Exact active SHA, Worker version, asset name, build ID-г энэ Git файлд “current” гэж
хадгалахгүй. Учир нь файлыг шинэчилсэн commit өөрөө `main` SHA болон deployment
identifier-уудыг дахин өөрчилнө. Current төлөвийг дээрх runtime UI/endpoint-оос
уншина; доорх exact identifier-ууд зөвхөн immutable historical release event байна.

AI/chat claim нь GitHub/runtime deployment evidence-ийг орлохгүй.

## 2. Completed

### Phase 0 — Core controller

- Cloudflare Worker/PWA production-д ажиллаж байна.
- `AUTH_TOKEN`, `GITHUB_TOKEN`, `DEEPSEEK_API_KEY` server-side secret.
- Bearer-protected ChatGPT Actions/OpenAPI ба Remote MCP.
- Project registry, repository read/search.
- Staged approval-gated write, prepared commit, safe branch push, CI/PR tools.

### Phase 1 — Repository stabilization

- OpenAPI description regression хамгаалалт.
- Branch list/compare/delete tool.
- SHA-pinned high-risk deletion approval.
- Superseded branch/PR cleanup foundation.

### Phase 2 — Project Brain v1

- PR #12 merged into `main` at `7695b1b...`.
- Locked Master v1 foundation.
- Canonical context/search.
- Durable development task ба handoff.
- 8 Project Brain Actions/MCP tools.
- Frontend lint/build, backend typecheck, 21/21 tests green at release.
- Tokenless Actions/MCP 401 security smoke.
- Production health build `project-brain-v1`.

## 3. Master v2 + Release Integrity v1 — RELEASED

Source branch: `agent/master-v2-creation-os`

Merged by PR #13 into `main` at `5be5d7d5ceb20b5de7c51a6a2d8a98b45744cdf3`.

Scope:

- v1 Master immutable archive;
- Personal Creation OS product contract;
- phone-only verified outcome North Star;
- Second Brain + Asset Graph;
- provider-neutral AI role system;
- Web Research Agent policy;
- Evidence/Semantic Approval/Rollback standard;
- corrected current-state Threat Model;
- target layered architecture;
- detailed Phase 2.1–10 execution roadmap;
- Project Brain canonical memory path expansion.

Released implementation:

- manual deploy workflow-д `main`-only `BC-R23` guard;
- backend `/api/release` source integrity contract;
- Cloudflare Worker version metadata binding;
- PWA build-д branch/SHA/build ID embedding;
- Settings дээр production/preview/stale/unverified release card;
- exact `main` SHA policy tests.

PR #13 merge үеийн historical release evidence:

- PR Test ба Validate workflows success;
- backend 26/26 tests + typecheck green;
- frontend lint + production PWA build green;
- remote Git tree local tree-тэй `ee38a73461e6ed247f2fab0876c5b931f60e8363` SHA-аар яг таарсан;
- backend `/health` шинэ build болон Worker version metadata-г production дээр буцаасан;
- public PWA bundle `main` merge SHA-г embed хийсэн;
- service worker шинэ JS/CSS asset-ийг precache хийж `skipWaiting` + `clientsClaim` идэвхжүүлсэн;
- public browser smoke Settings release card, `main · 5be5d7d5`, build metadata-г render хийснийг баталсан.

PR #14 release evidence record-ийг шинэчилж, installed PWA-ийн service-worker reload
cycle шинэ `main`-ийг авсныг баталсан. Мөн Git дотор content-addressed identifier-ийг
“current” гэж хуулан хадгалах нь commit бүрийн дараа өөрийгөө хуучруулдаг гэдгийг
илрүүлсэн; энэ файл одоо immutable event ба dynamic runtime truth-ийг тусгаарлана.

Үлдсэн: previous-good rollback controller ба бодит rollback/restore rehearsal.

## 4. Deployment integrity finding

Cloudflare Git integration өмнөх PR branch-ийн version-ийг merge-ээс өмнө deployment history-д харуулсан. Гэхдээ тухайн үед BestCode active traffic → branch → SHA холбоосыг durable evidence болгож хадгалаагүй. Иймээс branch version production traffic авсан гэж баттай хэлэх боломжгүй; өмнөх тайлан энэ дүгнэлтийг хэт итгэлтэй гаргасан.

Cloudflare-ийн current official default нь non-production branch-д `wrangler versions upload` ашиглан preview version үүсгэх явдал. Actual dashboard trigger configuration хараахан audit хийгдээгүй.

Status: **OPEN P0 observability/control gap** — production source таамаг биш evidence байх ёстой.

PR #16-ийн дараах анхны provider-level audit энэ gap-ийг бодитоор илрүүлсэн:

- frontend preview trigger `wrangler versions upload` ашиглаж, production isolation зөв байсан;
- backend preview trigger буруу `wrangler deploy` ашигласан;
- PR #16 branch-ийн backend version 100% production traffic авсныг active deployment →
  Workers Build branch/SHA mapping-аар баталсан;
- `Release Integrity` workflow exact unsafe preview command-ийг guarded auto-repair
  хийж, latest `main` push backend production source-ийг сэргээсэн.

Historical recovery evidence: GitHub run `29677501043`, artifact
`release-integrity-29677501043`, digest
`sha256:c9fb79e30cd67fcadcdaeae5c56791ffb8fde67770a98734fc70faa87380ee97`.
Тухайн event дээр backend/PWA хоёулаа `main` commit
`11862b7f4f351cc1a688abf0483c24c46c282499`-ийг 100% traffic-аар ажиллуулж,
хоёр preview trigger `wrangler versions upload` болсон.

Incident status: **REMEDIATED**. Deliberate non-main isolation probe болон rollback
rehearsal Phase 2.1A exit evidence-д үлдсэн.

Deliberate non-main isolation probe дараа нь амжилттай болсон. Probe branch
`agent/source-lock-probe-20260719-1`, commit
`435535cab8651ffd1193b067246e3eed4362a028` хоёр Worker дээр exact branch/SHA-аар
`wrangler versions upload` preview build үүсгэсэн боловч production traffic өөрчлөөгүй.
Backend болон installed PWA хоёулаа тухайн үеийн `main`
`bf76487c8ed7e3bfad8cd6131a5d16587af65c8a` дээр 100% хэвээр үлдсэн.

Historical isolation evidence: GitHub run `29677894804`, artifact
`source-isolation-29677894804-1`, digest
`sha256:c8e7660b895c7559e36776f469135f1374c72e24267f0c99a249f41db874f34a`.

Isolation proof status: **PASSED**. Одоо Phase 2.1A-д previous-good plan болон owner
approved rollback/restore rehearsal л үлдсэн.

Master v2 rule: `BC-R23` — non-main branch production traffic хэзээ ч авахгүй.

Immediate next package: Phase 2.1A-г actual trigger audit, preview/production separation proof, mismatch auto-rollback, rollback rehearsal-аар дуусгах.

## 5. Current live capability vs target

| Area | Current | Target gap |
|---|---|---|
| Auth | Shared Bearer token | client identity, capability, revoke, rate/replay |
| Project Brain | Git docs + task/handoff | Mission, Owner/World memory, Asset Graph |
| PWA Chat | local `/api/llm` DeepSeek loop | repository-aware Mission Orchestrator |
| Files | IndexedDB/GitHub import | professional tree/tabs/search/conflict |
| Preview | local preview + UI console capture | diagnostics evidence + AI repair loop |
| Approval | operation UI | semantic outcome/evidence/rollback, terminal state fix |
| Git delivery | branch/commit/push/PR + production build/source assertion v1 | trigger audit, previous-good rollback, automated mismatch stop |
| Research | none | safe search/source/claim/dossier pipeline |
| Runner | GitHub workflow dispatch only | isolated ephemeral terminal/build plane |
| Evidence | scattered GitHub/CI metadata | canonical append-only evidence records |
| Personal assets | repository/project files | exportable Asset Vault and reuse graph |

## 6. Known open defects/gaps

### P0

- Cloudflare trigger configuration provider API-аар verified, deliberate non-main
  isolation rehearsal passed; previous-good rollback/restore proof шаардлагатай.
- Approval UI terminal status дээр дахин decision илгээж алдаа харуулсан.
- Shared token-д rate/replay/per-client capability байхгүй.
- Critical workflow/path class болон independent review хэрэгжээгүй.

### P1

- Installed PWA-д build/source card ба stale reload нэмэгдсэн; update-available banner, history, rollback UI байхгүй.
- Preview diagnostics external AI/DeepSeek-д structured tool-оор очихгүй.
- Evidence record/redaction/acceptance mapping байхгүй.
- Task lease/heartbeat/idempotency бүрэн биш.
- Personal memory/Asset Graph байхгүй.

### Not implemented yet

- Web Research Agent;
- Browser Run integration;
- remote runner/container;
- semantic approval;
- cross-provider reviewer/router;
- real-world Engineering/Sourcing modes.

Эдгээрийг Master-д TARGET гэж тэмдэглэсэн; production capability гэж тайлагнахгүй.

## 7. Next execution order

1. Phase 2.1A — previous-good rollback plan ба owner-approved rollback/restore rehearsal-аар дуусгах.
2. Phase 2.1B — approval terminal-state/idempotency.
3. Phase 2.1C/D — auth/rate/redaction/critical path conformance.
4. Phase 3 — mobile version/update/semantic approval/rollback.
5. Phase 4 — Mission Control/Second Brain/Asset Graph.
6. Phase 5 — Web Research Agent v1.

## 8. Operational rule

Owner-оор GitHub/Cloudflare-ийн давтагдсан алхам хийлгэхгүй. Зөвхөн external account login, secret/billing setup, irreversible high-risk decision, safety-critical sign-off үед owner action авна.
