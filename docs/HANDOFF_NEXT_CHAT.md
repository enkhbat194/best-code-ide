# BestCode — Next Chat Handoff

Status: prepared on `agent/phase-2-1d-critical-path-foundation`
Owner command to resume: `үргэлжлүүл`

## 1. Төслийн үндсэн зорилго

BestCode-ийг утаснаас ашиглаж болох private, mobile-first Personal Creation OS болгоно. ChatGPT Actions, Claude MCP болон цаашдын native AI adapter-ууд нэг canonical project context, approval policy, task state, evidence болон repository controller ашиглана.

## 2. Canonical source of truth

Дараах файлыг эхэлж унш:

1. `BESTCODE_MASTER.md` — алсын хараа, үүрэг, safety contract.
2. `docs/ROADMAP.md` — хэрэгжүүлэлтийн canonical дараалал.
3. `docs/PROJECT_STATUS.md` — бодит current state.
4. `docs/ARCHITECTURE.md` — системийн бүтэц.
5. `docs/DECISIONS/BC-036-canonical-roadmap-lock.md` — roadmap ownership ба phase ordering.
6. `docs/PHASE_2_1D_CRITICAL_PATH_PROTECTION.md` — current package policy.
7. `docs/SECURITY_OPERATIONS.md` — Phase 2.1C security operations.

Chat transcript нь canonical memory биш. Repo дахь дээрх файл зөрчилдвөл canonical docs-ийг баримтал.

## 3. Locked roadmap дараалал

- Phase 0 — Core Controller: COMPLETED
- Phase 1 — Repository Stabilization: COMPLETED
- Phase 2 — Project Brain v1: COMPLETED
- Phase 2.1 — Production Integrity & Security Floor: IN PROGRESS
  - 2.1A Deployment source lock: COMPLETED
  - 2.1B Approval/idempotency: implementation complete, owner observation evidence тусдаа
  - 2.1C Auth/rate/redaction/audit: PR #25, CI green, review-ready
  - 2.1D Critical-path protection: PR #26, current active package
- Phase 3 — Mobile Trust UX & Release Control
- Phase 4 — Mission Control & Second Brain v2
- Phase 5 — Web Research Agent v1
- Phase 6 — Professional Creation Workspace & Diagnostics
- Phase 7 — Secure Runtime & Terminal
- Phase 8+ — Provider quality/economics, real-world modes, backup/migration

## 4. Энэ chat-д хийсэн ажил

### PR #24 — Canonical roadmap lock

- Branch: `agent/canonical-roadmap-lock`
- Purpose: `/docs/ROADMAP.md`-ийг sole implementation roadmap гэж түгжих decision record.
- CI: green.
- Merge/deploy status: шинэ chat эхлэхийн өмнө GitHub дээр дахин шалга.

### PR #25 — Phase 2.1C Security Floor

- Branch: `agent/phase-2-1c-request-redaction-foundation`
- CI: Test, Validate green.
- PR state: review-ready.
- Delivered:
  - route-aware request body limits;
  - default/chat/file/workspace size envelopes;
  - secret redaction;
  - owner 600/min, unauthorized 30/min safety ceilings;
  - origin allowlist foundation;
  - structured security audit events;
  - Durable Object audit retention/export;
  - security operations and token rotation runbook.
- Production behavior changes only after merge/deploy.

### PR #26 — Phase 2.1D Critical Path Protection

- Branch: `agent/phase-2-1d-critical-path-foundation`
- Base: PR #25 branch until PR #25 merges, then retarget to `main`.
- Delivered in this package:
  - `backend/src/criticalPaths.ts` classifier;
  - rule IDs `BC-R31`–`BC-R35`;
  - canonical/auth/workflow/deploy/dependency path classes;
  - `applyCriticalPathRisk()` enforcement;
  - `approvalClient.createApproval()` integration;
  - all staged approvals using `createApproval` are automatically promoted to `risk: high` when any changed path is critical;
  - exact `critical_path:<rule>` and `critical_path_file:<path>` reasons;
  - regression tests;
  - `.github/workflows/critical-path-conformance.yml`.

Important implementation detail: enforcement is placed in the shared `createApproval()` client, not duplicated separately in mobile REST and MCP. Therefore `repository_write_file`, `repository_apply_patch`, `repository_delete_file`, mobile staged file commits, and future approval producers using the shared client receive the same policy.

## 5. Current policy contract

Critical classes:

- `BC-R31`: Master, Roadmap, Project Status, Architecture, Decisions.
- `BC-R32`: auth, security, credential-handling paths.
- `BC-R33`: `.github/workflows/**`.
- `BC-R34`: deploy/runtime/release/rollback controls.
- `BC-R35`: package manifests, lockfiles, Wrangler, TypeScript/Vite build config.

Critical change contract:

- approval remains mandatory;
- risk must be `high`;
- exact rule and path must be owner-visible in `risk_reasons`;
- no direct main/master write;
- no approval reuse after context SHA changes;
- CI conformance must pass;
- production deployment remains main-only.

## 6. Шинэ chat эхлэхэд хийх яг дараалал

1. GitHub дээр PR #24, #25, #26-ийн state, head SHA, mergeability, CI-г дахин унш.
2. CI failure байвал log уншаад branch дээр шууд зас.
3. PR #25 green бөгөөд mergeable бол owner-ийн энэ chat дахь deploy approval-г баримтлан merge хий.
4. Production main deploy/build completion болон `/health`, `/api/release` smoke evidence шалга.
5. PR #26 base-ийг `main` руу retarget/rebase шаардлагатай эсэхийг шалга.
6. PR #26 CI-г main base дээр дахин ногоон болго.
7. PR #26 diff review:
   - shared approval integration байгаа;
   - ordinary path normal хэвээр;
   - critical path high болсон;
   - rule/path reasons давхардахгүй;
   - workflow өөрөө critical classifier test-д хамрагдсан.
8. PR #26-г review-ready болго.
9. Owner explicit deploy instruction энэ chat-д өгөгдсөн тул safety gate болон CI ногоон нөхцөл хангагдвал merge хий.
10. Main production deploy дууссаны дараа:
    - backend health;
    - release SHA/source;
    - OpenAPI availability;
    - protected endpoint unauthorized 401;
    - audit endpoint authenticated smoke;
    - нэг ordinary staged change normal risk;
    - нэг critical staged change high risk + `BC-Rxx` reasons;
    - PWA release card current main SHA-г харуулж буйг шалга.
11. Evidence-г `docs/PROJECT_STATUS.md` болон Phase 2.1D closeout decision/status file-д update хийх тусдаа branch/PR-аар оруул.
12. Phase 2.1D closeout дуусмагц canonical roadmap-ийн Phase 3A Version/update contract руу ор.

## 7. Phase 3A эхний багц

Goal: owner утаснаас яг ямар frontend/backend version ажиллаж байгааг, update хэрэгтэй эсэхийг нэг дэлгэцээс ойлгох.

First bounded package:

- frontend/backend schema compatibility version;
- stale-tab mismatch detector;
- service-worker update state machine;
- update available banner;
- safe reload/cache migration;
- offline recovery message;
- iOS installed PWA smoke checklist;
- regression tests.

Do not start editor, terminal, provider router, web browser, or multi-user work before Phase 3 gates.

## 8. Ажиллах дүрэм

Owner `үргэлжлүүл` гэж бичвэл:

- current package-ийг өөрөө шалгаж дуусга;
- саад гарвал өөрөө оношилж зас;
- CI-г өөрөө шалга;
- жижиг алхам бүрд owner-оос command нэхэхгүй;
- зөвхөн secret, payment, irreversible external decision, эсвэл GitHub/Cloudflare permission block үед зогсоно;
- нэг coherent package дууссаны дараа товч тайлан өг;
- дараагийн command: `үргэлжлүүл`.

## 9. Хориг

- `main` руу direct write хийхгүй.
- CI failure-ийг үл тоож merge хийхгүй.
- Protected branch, approval, source-lock, rollback guard тойрохгүй.
- Chat history-ийг source of truth гэж үзэхгүй.
- Fake completion/evidence бичихгүй.
- Production deploy болсон гэж provider evidence-гүй зарлахгүй.

## 10. Resume command

```text
үргэлжлүүл
```
