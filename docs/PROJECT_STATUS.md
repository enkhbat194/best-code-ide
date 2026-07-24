# BestCode — Project Status

Last updated: 2026-07-21

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

Phase 2.1A-н үлдсэн previous-good rollback controller болон бодит rollback/restore
rehearsal 2026-07-19-нд бүрэн дууссан. Exact evidence доорх deployment integrity
section-д байна.

## 4. Deployment integrity finding

Cloudflare Git integration өмнөх PR branch-ийн version-ийг merge-ээс өмнө deployment history-д харуулсан. Гэхдээ тухайн үед BestCode active traffic → branch → SHA холбоосыг durable evidence болгож хадгалаагүй. Иймээс branch version production traffic авсан гэж баттай хэлэх боломжгүй; өмнөх тайлан энэ дүгнэлтийг хэт итгэлтэй гаргасан.

Cloudflare-ийн current official default нь non-production branch-д `wrangler versions upload`
ашиглан preview version үүсгэх явдал. Actual trigger configuration provider API-аар audit
хийгдэж, backend/PWA хоёрын production болон preview command тус бүр exact contract-той
таарсан.

Status: **CLOSED / CONTINUOUSLY ENFORCED** — production source нь таамаг биш dynamic
runtime болон append-only CI evidence болсон.

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

Incident status: **REMEDIATED AND VERIFIED**. Deliberate non-main isolation probe болон
rollback rehearsal хоёулаа Phase 2.1A exit evidence-ийг хангасан.

Deliberate non-main isolation probe дараа нь амжилттай болсон. Probe branch
`agent/source-lock-probe-20260719-1`, commit
`435535cab8651ffd1193b067246e3eed4362a028` хоёр Worker дээр exact branch/SHA-аар
`wrangler versions upload` preview build үүсгэсэн боловч production traffic өөрчлөөгүй.
Backend болон installed PWA хоёулаа тухайн үеийн `main`
`bf76487c8ed7e3bfad8cd6131a5d16587af65c8a` дээр 100% хэвээр үлдсэн.

Historical isolation evidence: GitHub run `29677894804`, artifact
`source-isolation-29677894804-1`, digest
`sha256:c8e7660b895c7559e36776f469135f1374c72e24267f0c99a249f41db874f34a`.

Isolation proof status: **PASSED**.

Owner-approved rollback/restore rehearsal мөн амжилттай болсон:

- GitHub run: `29683440382`;
- artifact: `rollback-rehearsal-approved-29683440382-1` (ID `8441302013`);
- digest: `sha256:9139cd1b05a47dfedf674e383126a5cf45508395178f6535a2c2e1566981892f`;
- backend previous-good `c1adc845-1015-4d25-b77a-5803788853b8` rollback smoke 200,
  current `d3547d17-fd45-4473-a1e3-e6ab65ea85c9` restore smoke 200;
- PWA previous-good `9a6874a0-0080-4533-a68a-8f34145e88d9` rollback smoke 200,
  current `7b256100-bef7-4ba6-b864-5ff6f0b2e54a` restore smoke 200;
- хоёр evidence record хоёулаа `ok=true`, `restored=true`, error=null.

Rollback proof status: **PASSED**. Phase 2.1A: **COMPLETED**.

Master v2 rule: `BC-R23` — non-main branch production traffic хэзээ ч авахгүй.

Current delivery package: Phase 2.1B — approval terminal-state, stale decision,
idempotency/replay хамгаалалт. Production owner observation exact `main · 15e23fb4`
дээр passed. System Maintenance Center implementation PR #22-д staged; branch-aware
stale approval regression хамгаалалт нэмэгдсэн. Final operational closure нь merge/deploy
хийсний дараа SHA-pinned approval болон merged-branch cleanup-ийг нэг удаа ажиллуулах.

## 5. Current live capability vs target

### Mission Execution Runtime foundation — CODE_READY_NOT_MERGED

- `bestcode-execution-plan-v1` болон `bestcode-execution-task-v1` provider-neutral schema;
- deterministic SHA-256 plan/result hash;
- fail-closed task state machine болон hard/optional dependency DAG;
- capability/safety-profile assignment;
- single-task lease, TTL, heartbeat, takeover fencing token;
- append-only progress, evidence-required result, blocker/retry/cancel contract;
- 20 owner/full MCP operation schema;
- subscription profile exact 12 read-only tool хэвээр;
- durable execution store migration, production mutation profile, live multi-agent run хийгдээгүй.

| Area | Current | Target gap |
|---|---|---|
| Auth | Shared Bearer token | client identity, capability, revoke, rate/replay |
| Project Brain | Git docs + task/handoff | Mission, Owner/World memory, Asset Graph |
| PWA Chat | local `/api/llm` DeepSeek loop | repository-aware Mission Orchestrator |
| Files | IndexedDB/GitHub import | professional tree/tabs/search/conflict |
| Preview | local preview + UI console capture | diagnostics evidence + AI repair loop |
| Approval | terminal state, TTL/context SHA, decision idempotency, stale invalidation | full semantic outcome/evidence/rollback card |
| Git delivery | branch/commit/push/PR + production source lock + tested previous-good rollback v1 | owner-visible release history, incident UX, one-tap approved rollback |
| Maintenance | authenticated branch-aware stale approval and SHA-pinned merged branch cleanup staged | archive policy, scheduled GC, storage analytics |
| Research | none | safe search/source/claim/dossier pipeline |
| Runner | GitHub workflow dispatch only | isolated ephemeral terminal/build plane |
| Evidence | scattered GitHub/CI metadata | canonical append-only evidence records |
| Personal assets | repository/project files | exportable Asset Vault and reuse graph |

## 6. Known open defects/gaps

### P0

- Phase 2.1B maintenance implementation-ийг merge/deploy хийж, хоёр cleanup action-ийг ажиллуулах шаардлагатай.
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

1. PR #22 CI → squash merge/deploy → System Maintenance Center cleanup → Phase 2.1B COMPLETED.
2. Phase 2.1C/D — auth/rate/redaction/critical path conformance.
3. Phase 3 — mobile version/update/semantic approval/rollback.
4. Phase 4 — Mission Control/Second Brain/Asset Graph.
5. Phase 5 — Web Research Agent v1.

## 8. Operational rule

Owner-оор GitHub/Cloudflare-ийн давтагдсан алхам хийлгэхгүй. Зөвхөн external account login, secret/billing setup, irreversible high-risk decision, safety-critical sign-off үед owner action авна.
