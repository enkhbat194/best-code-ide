# BestCode — Project Status

Last updated: 2026-07-19

Canonical plan after this package merges: `/BESTCODE_MASTER.md` v2.0.0 (`LOCKED`)

## 1. Production source of truth

- Repository: `enkhbat194/best-code-ide`
- Default branch: `main`
- Verified `main` before Master v2 package: `7695b1b36a38c6d30d5ed485204d46ed45692610`
- Backend: `https://best-code-ide.enkhbat194.workers.dev`
- Backend health verified: `{"ok":true,"build":"project-brain-v1"}`
- Installed PWA: `https://best-code-ide-appl.enkhbat194.workers.dev`
- Manual frontend target: `https://best-code-ide-app.enkhbat194.workers.dev`
- Known remote branches before this package: `main`, merged `agent/project-brain-v1`

AI/chat claim нь дээрх GitHub/deployment evidence-ийг орлохгүй.

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

## 3. Master v2 package

Working branch: `agent/master-v2-creation-os`

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

Implementation progress on this working branch:

- manual deploy workflow-д `main`-only `BC-R23` guard;
- backend `/api/release` source integrity contract;
- Cloudflare Worker version metadata binding;
- PWA build-д branch/SHA/build ID embedding;
- Settings дээр production/preview/stale/unverified release card;
- exact `main` SHA policy tests.

Validation: backend 26/26 tests + typecheck, frontend lint + production PWA build green. Энэ нь merge/deploy evidence биш; production trigger audit, active URL verification, rollback rehearsal үлдсэн.

This document becomes canonical only after owner-approved PR, green CI, merge and production context verification.

## 4. Deployment integrity finding

Cloudflare Git integration өмнөх PR branch-ийн version-ийг merge-ээс өмнө deployment history-д харуулсан. Гэхдээ тухайн үед BestCode active traffic → branch → SHA холбоосыг durable evidence болгож хадгалаагүй. Иймээс branch version production traffic авсан гэж баттай хэлэх боломжгүй; өмнөх тайлан энэ дүгнэлтийг хэт итгэлтэй гаргасан.

Cloudflare-ийн current official default нь non-production branch-д `wrangler versions upload` ашиглан preview version үүсгэх явдал. Actual dashboard trigger configuration хараахан audit хийгдээгүй.

Status: **OPEN P0 observability/control gap** — production source таамаг биш evidence байх ёстой.

Master v2 rule: `BC-R23` — non-main branch production traffic хэзээ ч авахгүй.

Immediate next package: Phase 2.1A deployment source lock, active SHA assertion, preview/production separation, rollback rehearsal.

## 5. Current live capability vs target

| Area | Current | Target gap |
|---|---|---|
| Auth | Shared Bearer token | client identity, capability, revoke, rate/replay |
| Project Brain | Git docs + task/handoff | Mission, Owner/World memory, Asset Graph |
| PWA Chat | local `/api/llm` DeepSeek loop | repository-aware Mission Orchestrator |
| Files | IndexedDB/GitHub import | professional tree/tabs/search/conflict |
| Preview | local preview + UI console capture | diagnostics evidence + AI repair loop |
| Approval | operation UI | semantic outcome/evidence/rollback, terminal state fix |
| Git delivery | branch/commit/push/PR foundation | release source lock and active SHA proof |
| Research | none | safe search/source/claim/dossier pipeline |
| Runner | GitHub workflow dispatch only | isolated ephemeral terminal/build plane |
| Evidence | scattered GitHub/CI metadata | canonical append-only evidence records |
| Personal assets | repository/project files | exportable Asset Vault and reuse graph |

## 6. Known open defects/gaps

### P0

- Active PWA deployment-ийн branch/SHA/traffic mapping нотлогдохгүй байна; actual Cloudflare trigger audit шаардлагатай.
- Release assertion card энэ package-д нэмэгдсэн; production дээрх active URL/SHA verification хийгдээгүй.
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

1. Phase 2.1A — package-ийг merge/deploy хийж, production trigger/source/rollback evidence-ээр дуусгах.
2. Phase 2.1B — approval terminal-state/idempotency.
3. Phase 2.1C/D — auth/rate/redaction/critical path conformance.
4. Phase 3 — mobile version/update/semantic approval/rollback.
5. Phase 4 — Mission Control/Second Brain/Asset Graph.
6. Phase 5 — Web Research Agent v1.

## 8. Operational rule

Owner-оор GitHub/Cloudflare-ийн давтагдсан алхам хийлгэхгүй. Зөвхөн external account login, secret/billing setup, irreversible high-risk decision, safety-critical sign-off үед owner action авна.
