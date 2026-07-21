# BestCode — Шинэ chat handoff v2

Owner resume command: `үргэлжлүүл`

## 1. Эхлээд унших canonical дараалал

1. `BESTCODE_MASTER.md`
2. `docs/ROADMAP.md`
3. `docs/PROJECT_STATUS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DECISIONS/BC-036-canonical-roadmap-lock.md`
6. `docs/PHASE_2_1D_CRITICAL_PATH_PROTECTION.md`
7. `docs/SECURITY_OPERATIONS.md`
8. энэ файл: `docs/HANDOFF_NEXT_CHAT_V2.md`

Chat transcript нь canonical source биш. Repository доторх дээрх файлуудыг эхэлж уншина.

## 2. Одоогийн production truth

- Repository: `enkhbat194/best-code-ide`
- Production/default branch: `main`
- Current verified main/PWA SHA: `525bec1d340a3e89befc9a69e166025a53c2f0fe`
- PWA Settings дээр owner 2026-07-21-нд дараахыг бодитоор баталсан:
  - App source: `main · 525bec1d`
  - GitHub main: `525bec1d`
  - Integrity: `Production source баталгаатай`
  - Deploy policy: `BC-R23 · main only`
- Maintenance Center ажилласан:
  - stale approvals: `0`
  - merged branches цэвэрлэхийн өмнө: `16`
  - цэвэрлэсний дараа: `0`
- Approval queue одоо зөвхөн идэвхтэй `pending_approval` хүсэлт харуулна.

## 3. Энэ chat-д merge болсон багцууд

### PR #24 — Canonical roadmap lock

- Merge SHA: `c0adb915af800c59fb0e5f3bac9a66e7a253a83c`
- `/docs/ROADMAP.md` canonical implementation roadmap гэж түгжсэн.

### PR #25 — Phase 2.1C Security Floor

- Merge SHA: `4ab43a0ddb756b63c9bdcdc32a2e04dc4d1be7a3`
- Request-size route profiles
- owner/unauthorized rate profiles
- strict origin policy foundation
- secret redaction
- persistent security audit/export
- security runbooks/tests

### PR #27 — Phase 2.1D Critical Path Protection

- Merge SHA: `c9a0ccce3053567a04092f7add6569ae01ff6cea`
- Critical path rule IDs:
  - `BC-R31` canonical source
  - `BC-R32` security/auth
  - `BC-R33` workflow/release
  - `BC-R34` deploy/runtime
  - `BC-R35` dependency control
  - `BC-R30` ordinary
- shared `approvalClient.createApproval()` critical changes-ийг автоматаар `risk: high` болгоно.
- exact `critical_path:BC-Rxx` болон `critical_path_file:<path>` reasons хадгална.
- Test, Validate, Critical Path Conformance green байсан.

### PR #28 — First handoff

- Merge SHA: `296870fbb2cd2b2ff0b562eee4de48b8f8d8ed15`
- `docs/HANDOFF_NEXT_CHAT.md` нэмсэн.

### PR #29 — Maintenance cleanup UX v2

- Merge SHA: `525bec1d340a3e89befc9a69e166025a53c2f0fe`
- Terminal approvals default queue-ээс салсан.
- `/api/approvals` default-аар зөвхөн pending хүсэлт буцаана.
- Squash/rebase merge болсон PR head branch-ийг exact SHA evidence-ээр Maintenance Center танина.
- 16 merged branch owner action-аар амжилттай цэвэрлэгдсэн.
- Final Test + Validate green.

## 4. Одоогийн branch төлөв

Maintenance cleanup-ийн дараа `main`-ээс гадна 4 branch үлдсэн.

### KEEP / тусдаа шийдвэр шаардлагатай

- `agent/phase-3-agent-runtime-foundation`
  - PR #23 open/draft.
  - Canonical roadmap-ийн шинэ ангиллаар энэ нь Phase 3 биш, Phase 4 Mission Control & Second Brain v2 foundation-д илүү тохирно.
  - Шууд merge хийхгүй.
  - Дараагийн chat эхлэхэд PR #23 diff-ийг current main-тай тулгаж review хийнэ.
  - Сонголт: retarget/rename/rebase хийх эсвэл хэрэгтэй commit-үүдийг цэвэр шинэ Phase 4 branch руу cherry-pick хийх.

### AUDIT → DELETE_SAFE гэж шалгах

- `agent/phase-2-1d-critical-path-foundation`
  - superseded stacked PR #26 branch.
  - Clean PR #27 merge болсон тул энэ branch ихэнхдээ хэрэггүй.
- `agent/rollback-rehearsal-*`
  - Phase 2.1A evidence/probe branch.
  - canonical evidence main дээр орсон эсэхийг тулгаад устгаж болно.
- `agent/source-lock-probe-*`
  - production source-lock proof branch.
  - evidence main дээр орсон эсэхийг тулгаад устгаж болно.

Дүрэм: branch нэрээр сохроор устгахгүй. Current SHA, open PR, unique commits, canonical evidence-г шалгасны дараа л устгана.

## 5. Canonical roadmap status

- Phase 0 Core Controller: COMPLETED
- Phase 1 Repository Stabilization: COMPLETED
- Phase 2 Project Brain v1: COMPLETED
- Phase 2.1 Production Integrity & Security Floor: functional implementation completed; formal closeout record pending
  - 2.1A source lock/rollback: COMPLETED
  - 2.1B approval/idempotency/maintenance: implemented and owner-observed
  - 2.1C auth/rate/redaction/audit: MERGED
  - 2.1D critical-path protection: MERGED and production source verified
- Phase 3 Mobile Trust UX & Release Control: NEXT
- Phase 4 Mission Control & Second Brain v2
- Phase 5 Web Research Agent v1
- Phase 6 Professional Creation Workspace & Diagnostics
- Phase 7 Secure Runtime & Terminal
- Phase 8 Provider Quality, Routing & Economics
- Phase 9 Real-world Creation Modes
- Phase 10 Asset Vault, Backup & Migration

## 6. Шинэ chat эхлэх яг дараалал

### Package A — Phase 2.1 formal closeout

1. `main` SHA `525bec1d...` эсвэл түүнээс хойших current main-ийг шалга.
2. PWA/production source integrity-г `/api/release` болон owner-visible Settings evidence-тэй тулга.
3. Existing smoke coverage-г шалга:
   - `/health`
   - `/api/release`
   - `/openapi.json`
   - protected endpoint unauthorized `401`
   - authenticated `/api/security/audit`
4. Critical-path classifier regression-ийг шалга:
   - ordinary file → normal
   - critical file → high + exact rule/file reason
5. `docs/PROJECT_STATUS.md`, `docs/ROADMAP.md`, шаардлагатай decision/status record дээр Phase 2.1 closeout update хийх.
6. Branch → tests → PR → merge → production source verification.

### Package B — Үлдсэн branch audit

1. Дээрх 4 branch-ийг current main-тай compare хийх.
2. PR #23-ыг Phase 4 foundation гэж дахин ангилах.
3. 3 superseded/evidence branch unique commit-гүй бол safe delete хийх.
4. Cleanup хийсний дараа Maintenance Center болон branch list-ийг шинэчилж `main + зориуд хадгалсан branch` л үлдсэн эсэхийг батлах.

### Package C — Phase 3A Version/update contract

Goal: owner утаснаас frontend/backend version, compatibility, stale update, recovery төлөвийг нэг дэлгэцээс ойлгох.

Scope:

- frontend/backend schema compatibility version
- stale-tab mismatch detector
- service-worker update state machine
- update available banner
- safe cache migration/reload
- offline recovery message
- iOS installed-PWA smoke checklist
- regression tests
- owner-visible release evidence

Phase 3 gate-ээс өмнө editor/terminal/provider router/multi-user work руу үсрэхгүй.

## 7. Ажиллах дүрэм

Owner `үргэлжлүүл` гэж бичвэл:

1. current package-ийг шалгаад дуусгана;
2. blocker гарвал өөрөө оношилж засна;
3. CI унавал log уншиж засварлаад дахин ажиллуулна;
4. жижиг алхам бүрт owner-оос command нэхэхгүй;
5. нэг coherent package дуусмагц дараагийн package руу шууд орно;
6. зөвхөн secret, payment, permission, irreversible external action, эсвэл owner-ийн бодит product decision шаардлагатай үед зогсоно;
7. production deploy/merge хийсэн гэж provider evidence-гүй зарлахгүй;
8. `main/master` direct write хийхгүй;
9. critical path change бүр high-risk approval policy-г дагана;
10. тайланг монгол кириллээр, товч бөгөөд яг хийсэн баримтаар өгнө.

## 8. Шинэ chat-д өгөх эхний prompt

```text
GitHub repository `enkhbat194/best-code-ide` доторх `docs/HANDOFF_NEXT_CHAT_V2.md`-г эхлээд бүрэн унш. Дараа нь canonical дарааллаар `BESTCODE_MASTER.md`, `docs/ROADMAP.md`, `docs/PROJECT_STATUS.md`, `docs/ARCHITECTURE.md` болон handoff-д заасан decision/security файлуудыг унш.

Handoff-ийн current production truth, merge SHA, branch төлөв, Phase 2.1 closeout болон Phase 3A дарааллыг source of truth болго. Chat history дээр таамаглахгүй.

Би `үргэлжлүүл` гэж бичихэд жижиг алхам бүрээр асуулт тавилгүй:
- эхлээд Phase 2.1 formal closeout-ийг дуусга;
- blocker/CI алдааг өөрөө зас;
- дараа нь үлдсэн branch audit/cleanup хий;
- дараа нь Phase 3A Version/update contract багцыг эхлүүл.

Main/master direct write бүү хий. Branch → tests → PR → merge → production evidence дарааллыг баримтал. Secret, payment, permission эсвэл irreversible external action хэрэгтэй үед л зогсоо.
```

## 9. Resume

```text
үргэлжлүүл
```
