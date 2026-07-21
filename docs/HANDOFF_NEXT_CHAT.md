# BestCode — Next Chat Handoff

Owner resume command: `үргэлжлүүл`

## 1. Canonical унших дараалал

1. `BESTCODE_MASTER.md`
2. `docs/ROADMAP.md`
3. `docs/PROJECT_STATUS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DECISIONS/BC-036-canonical-roadmap-lock.md`
6. `docs/PHASE_2_1D_CRITICAL_PATH_PROTECTION.md`
7. `docs/SECURITY_OPERATIONS.md`

Chat transcript нь canonical memory биш.

## 2. Locked roadmap

- Phase 0 Core Controller: COMPLETED
- Phase 1 Repository Stabilization: COMPLETED
- Phase 2 Project Brain v1: COMPLETED
- Phase 2.1 Production Integrity & Security Floor: IN PROGRESS
  - 2.1A source lock/rollback: COMPLETED
  - 2.1B approval/idempotency: implemented; owner observation evidence тусдаа
  - 2.1C auth/rate/redaction/audit: MERGED
  - 2.1D critical-path protection: MERGED; production smoke/closeout evidence pending verification
- Phase 3 Mobile Trust UX & Release Control
- Phase 4 Mission Control & Second Brain v2
- Phase 5 Web Research Agent v1
- Phase 6 Professional Creation Workspace & Diagnostics
- Phase 7 Secure Runtime & Terminal

## 3. Энэ chat-д дууссан зүйл

### PR #24 — Canonical roadmap lock

- Merged.
- Merge SHA: `c0adb915af800c59fb0e5f3bac9a66e7a253a83c`.

### PR #25 — Phase 2.1C Security Floor

- Merged.
- Merge SHA: `4ab43a0ddb756b63c9bdcdc32a2e04dc4d1be7a3`.
- Delivered request-size envelopes, redaction, owner/unauthorized rate profiles, origin policy, persistent security audit/export, runbooks and tests.

### PR #27 — Phase 2.1D Critical Path Protection

- Merged.
- Merge SHA: `c9a0ccce3053567a04092f7add6569ae01ff6cea`.
- CI before merge:
  - Test: success
  - Validate: success
  - Critical Path Conformance: success
- Superseded stacked PR #26, which was closed without merge.

Delivered:

- `BC-R31` canonical source
- `BC-R32` security/auth
- `BC-R33` workflow/release
- `BC-R34` deploy/runtime
- `BC-R35` dependency control
- `BC-R30` ordinary
- shared `approvalClient.createApproval()` calls `applyCriticalPathRisk()` before persistence
- critical staged changes become `risk: high`
- exact `critical_path:BC-Rxx` and `critical_path_file:<path>` reasons are stored
- ordinary staged changes preserve existing risk
- `.github/workflows/critical-path-conformance.yml`
- `docs/PHASE_2_1D_CRITICAL_PATH_PROTECTION.md`

## 4. Шинэ chat эхлэх яг дараалал

1. Current GitHub `main` SHA болон production deployment source/version-ийг шалга.
2. Production smoke:
   - `/health`
   - `/api/release`
   - `/openapi.json`
   - protected endpoint unauthorized `401`
   - authenticated `/api/security/audit`
3. Canary staging smoke:
   - ordinary file → normal risk
   - critical file → high risk + exact `BC-Rxx` reasons
   - canary operation-ийг deliver хийхгүй; reject/cancel/expire цэвэрлэ.
4. Smoke/evidence бүтэн бол Phase 2.1D closeout-ийг `docs/PROJECT_STATUS.md`, `docs/ROADMAP.md` болон decision/status record-д тусдаа branch/PR-аар оруул.
5. Phase 3A Version/update contract эхлүүл.

Production deploy болсон гэж provider evidence-гүй зарлахгүй. Merge нь хийгдсэн; Cloudflare auto-deploy болон live source verification-ийг шинэ chat эхлэхэд хамгийн түрүүнд баталгаажуул.

## 5. Phase 3A эхний багц

Goal: owner утаснаас яг ямар frontend/backend version ажиллаж байгааг, update хэрэгтэй эсэхийг нэг дэлгэцээс ойлгох.

- frontend/backend schema compatibility version
- stale-tab mismatch detector
- service-worker update state machine
- update available banner
- safe cache migration/reload
- offline recovery message
- iOS installed PWA smoke checklist
- regression tests

Editor, terminal, browser agent, provider router, multi-user work руу Phase 3 gate-ээс өмнө үсрэхгүй.

## 6. Ажиллах дүрэм

Owner `үргэлжлүүл` гэж бичвэл:

- current package-ийг дуусга;
- blocker-ийг өөрөө зас;
- CI-г өөрөө шалга;
- жижиг алхам бүрд command нэхэхгүй;
- secret/payment/permission/irreversible external decision үед л зогсоно;
- нэг coherent package дуусахад товч тайлан өг.

## 7. Resume

```text
үргэлжлүүл
```
