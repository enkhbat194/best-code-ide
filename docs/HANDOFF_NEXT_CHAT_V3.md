# BestCode — Project Audit & Next Chat Handoff v3

Status: `AUDITED_HANDOFF`
Audit date: `2026-07-21`
Owner resume command: `үргэлжлүүл`
Repository: `enkhbat194/best-code-ide`

> Энэ файл нь шинэ chat-д төслийн бодит төлөв, хийсэн ажил, дутуу ажил, эрсдэл, branch/PR төлөв болон яг дараагийн дарааллыг нэг дор өгөх operational handoff юм. Phase-ийн canonical дарааллыг `docs/ROADMAP.md`, бүтээгдэхүүний үндсэн хуулийг `BESTCODE_MASTER.md` тогтооно.

---

## 1. Эхлээд унших дараалал

Шинэ chat дараах файлуудыг энэ дарааллаар бүрэн уншина:

1. `BESTCODE_MASTER.md`
2. `docs/DECISIONS/BC-036-canonical-roadmap-lock.md`
3. `docs/ROADMAP.md`
4. `docs/PROJECT_STATUS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/EVIDENCE_STANDARD.md`
7. `docs/THREAT_MODEL.md`
8. `docs/SECURITY_OPERATIONS.md`
9. `docs/PHASE_2_1D_CRITICAL_PATH_PROTECTION.md`
10. `docs/HANDOFF_NEXT_CHAT_V3.md`

`docs/HANDOFF_NEXT_CHAT.md` болон `docs/HANDOFF_NEXT_CHAT_V2.md` нь historical handoff. **Одоогийн resume source нь энэ v3 файл.**

Chat transcript, AI-ийн тайлбар, screenshot дангаараа canonical source биш. GitHub `main`, production runtime evidence, CI болон owner observation хооронд зөрүү байвал зөрүүг incident/gap гэж тэмдэглэнэ.

---

## 2. Audit хийсэн эх сурвалж

Энэ handoff-ийг бэлтгэхдээ дараахыг дахин шалгасан:

- `BESTCODE_MASTER.md` v2.0.0, `LOCKED`;
- canonical `docs/ROADMAP.md`;
- `docs/PROJECT_STATUS.md`;
- `docs/ARCHITECTURE.md`;
- accepted decision `BC-036`;
- Phase 2.1C security operations document;
- Phase 2.1D critical-path contract;
- GitHub repository metadata;
- current recent commit history;
- open pull requests;
- PR #23 patch and its task planner/runtime scope;
- PR #24, #25, #27, #28, #29 merge history;
- owner-provided installed-PWA screenshots;
- Maintenance Center cleanup result.

### Audit limitation

GitHub connector-ийн branch search энэ audit үед branch нэрсийг буцаагаагүй. Тиймээс branch жагсаалтыг owner-ийн PWA screenshot, PR metadata, known head SHA-тай тулгасан. Нэг rollback branch-ийн full нэр UI дээр ellipsis-тэй байсан; exact нэрийг **таамаглахгүй**, next-chat read-only branch list-ээр эхэлж тогтооно.

---

## 3. Одоогийн truth — хамгийн чухал ялгаа

### 3.1 Git truth

Audit эхлэх үеийн GitHub `main` HEAD:

```text
2b52bc9a4c2948225b0fc7f61ba6c0dc1661e6fe
Add complete next-chat handoff v2
```

Энэ commit нь `docs/HANDOFF_NEXT_CHAT_V2.md`-г **PR-гүйгээр шууд main дээр** нэмсэн process deviation юм. Код өөрчлөөгүй боловч `main/master direct write хийхгүй` гэсэн тогтсон дүрмийг зөрчсөн.

### 3.2 Last verified runtime truth

Owner-ийн хамгийн сүүлийн PWA screenshot-аар батлагдсан production source:

```text
App source:   main · 525bec1d
GitHub main:  525bec1d
Integrity:    Production source баталгаатай
Deploy rule:  BC-R23 · main only
```

Exact verified runtime SHA:

```text
525bec1d340a3e89befc9a69e166025a53c2f0fe
```

### 3.3 Одоо батлах ёстой gap

GitHub `main` audit эхлэхэд `2b52bc9...` болсон боловч owner-ийн runtime evidence `525bec1d...` дээр байна. Cloudflare auto-deploy дараа шинэ SHA ажиллаж байж болох ч **provider/runtime evidence-гүйгээр батлагдсан гэж зарлахгүй**.

Шинэ chat-ийн хамгийн эхний read-only шалгалт:

1. current GitHub `main` HEAD;
2. PWA `/api/release` болон Settings source SHA;
3. backend `/health` version metadata;
4. active Cloudflare source/version;
5. GitHub main ба хоёр production Worker exact SHA таарч байгаа эсэх.

### 3.4 Production endpoints

- Backend Worker: `https://best-code-ide.enkhbat194.workers.dev`
- Installed PWA: `https://best-code-ide-appl.enkhbat194.workers.dev`
- Manual frontend target: `https://best-code-ide-app.enkhbat194.workers.dev`
- Public health: `/health`
- Public OpenAPI: `/openapi.json`
- Protected release evidence: `/api/release`
- Protected security audit: `/api/security/audit`

### 3.5 Repository visibility

GitHub repository audit үед:

```text
visibility: public
archived: false
default branch: main
owner permission: admin
```

BestCode нь owner-ийн хувийн Personal Creation OS тул repository-г public хэвээр үлдээх эсэх нь owner-ийн тусдаа product/security шийдвэр. **Автоматаар private болгохгүй.** Secret-үүд repository-д байх ёсгүй боловч source, architecture, workflow public харагдаж байна.

---

## 4. Бүтээгдэхүүний зорилго

BestCode-ийн нэг өгүүлбэрийн зорилго:

> Owner утсаараа монголоор зорилгоо хэлж, Git/CI/deploy-ийн давтагдсан ажиллагааг өөрөө хийхгүйгээр, эх сурвалжтай, шалгагдсан, rollback боломжтой, owner-д бүрэн үлдэх бодит asset бүтээнэ.

BestCode нь зөвхөн IDE эсвэл AI chat биш. Энэ нь:

- owner intent;
- canonical project memory;
- provider-neutral AI roles;
- approval/risk policy;
- evidence;
- GitHub/CI/release execution;
- reusable asset ownership

зэргийг нэг control plane-д нэгтгэх зорилготой.

North Star:

```text
phone-only verified outcome
```

---

## 5. Одоогийн production architecture

### LIVE topology

```text
ChatGPT Actions ─┐
Claude MCP ──────┼─> BestCode Cloudflare Worker
BestCode PWA ────┘          │
       └─ DeepSeek API       ├─ Durable Object approval/task/handoff/audit
                             ├─ GitHub repository/PR/workflows
                             └─ Cloudflare Workers deployments
```

### Одоогийн үндсэн source of truth

- software truth: GitHub `main`;
- runtime truth: Cloudflare active deployment + `/api/release`;
- intent truth: `BESTCODE_MASTER.md` + accepted decisions;
- implementation order: `docs/ROADMAP.md`;
- current status: `docs/PROJECT_STATUS.md`;
- AI chat: тайлбар, canonical биш.

---

## 6. Одоо бодитоор ажиллаж байгаа capability audit

| Area | Status | Одоогийн бодит capability |
|---|---|---|
| Backend/PWA | LIVE | Cloudflare Worker backend, installed mobile PWA |
| Auth | LIVE/PARTIAL | Protected routes shared Bearer `AUTH_TOKEN`; secrets server-side |
| ChatGPT | LIVE | OpenAPI 3.1 Actions, project/repository/approval/task tools |
| Claude | LIVE | Remote MCP shared executor/policy |
| DeepSeek | PARTIAL | Server-side `/api/llm` coding/diagnostic helper; canonical orchestrator биш |
| Project registry | LIVE | Allowed repository/project mapping |
| Repository read | LIVE | tree/list/read/search/compare/branch tools |
| Repository write | LIVE | staged write/patch/delete → owner approval → commit/push/PR |
| Main protection | LIVE/PARTIAL | app/backend main/master write guard, main-only deployment rule; GitHub-host branch protection setting тусдаа audit шаардлагатай |
| Approval | LIVE | terminal state, TTL, context SHA, idempotent decision, stale-context supersede |
| Branch deletion | LIVE | exact SHA-pinned high-risk approval, default/protected guard |
| Build/test | LIVE | GitHub Actions dispatch/status/log/cancel foundation |
| Deployment | LIVE | approval-gated deploy tools + Cloudflare Git main-only source lock |
| Release integrity | LIVE | PWA source/SHA card, backend/Worker metadata, source mismatch detection |
| Rollback | LIVE | previous-good plan, owner-approved rollback/restore rehearsal, smoke |
| Maintenance | LIVE | stale approval supersede, merged branch bulk cleanup |
| Request limits | LIVE/PARTIAL | route-based 1/2/5/10 MiB HTTP envelopes; repository total size limit биш |
| Rate limit | LIVE/PARTIAL | owner-friendly/unauthorized profiles; Worker-instance-local, distributed quota биш |
| Redaction | LIVE/PARTIAL | bearer/query/provider/common secret redaction helpers/tests |
| CORS/origin | PARTIAL | allowlist foundation; strict production migration/config evidence дутуу |
| Security audit | LIVE/PARTIAL | persistent bounded audit store + owner export API; tamper-evident Evidence Service биш |
| Critical path | LIVE/PARTIAL | BC-R31–R35 classifier, staged critical change automatic high risk, CI conformance |
| Project Brain v1 | LIVE | canonical context/search, durable development task/handoff |
| Agent Runtime | CODE_READY_NOT_MERGED | PR #23 planner/task API branch дээр; production биш |
| Files workspace | PARTIAL | mobile Files view, GitHub import/local IndexedDB; professional tree/editor биш |
| Preview | PARTIAL | local preview/console foundation; remote isolated runtime биш |
| Research | TARGET | Web Research Agent implementation байхгүй |
| Terminal/runner | TARGET | GitHub Actions-аас өөр isolated runtime/terminal байхгүй |
| Asset Vault | TARGET | reusable asset graph/export/backup system байхгүй |

---

## 7. Хийсэн ажлын timeline — grouped PR audit

### Core controller and mobile coding foundation

- PR #2 — repository-aware mobile coding agent core;
- PR #3 — autonomous validation/repair loop foundation;
- PR #4 — read-only MCP project controller;
- PR #5 — approval-gated staged repository changes;
- PR #6 — prepared commit, safe push, build/test task delivery;
- PR #8 — safe Custom GPT Actions API;
- PR #9 — approval-gated production deployment v2.

### Repository stabilization

- PR #10 — OpenAPI description bound + branch management;
- PR #11 — approval-gated branch cleanup PWA.

### Project Brain v1

- PR #12 — locked project context, memory search, durable tasks/handoffs, Actions/MCP parity.

### Master v2 and release integrity

- PR #13 — `BESTCODE_MASTER.md` v2, release integrity UI/API, main-only `BC-R23`;
- PR #14 — production evidence record;
- PR #15 — dynamic release truth semantics correction;
- PR #16 — provider-level production source-lock audit;
- PR #17 — deliberate non-main isolation proof;
- PR #18 — exact previous-good rollback controller;
- PR #19 — successful rollback/restore evidence closeout.

### Approval/idempotency/maintenance

- PR #20 — terminal decisions, stable idempotency, stale context invalidation;
- PR #21 — stale installed-PWA cache recovery;
- PR #22 — branch-aware Maintenance Center and Phase 2.1B operations.

### Canonical roadmap and security floor

- PR #24 — canonical roadmap lock, merge SHA `c0adb915...`;
- PR #25 — Phase 2.1C security floor, merge SHA `4ab43a0d...`;
- PR #27 — critical-path protection, merge SHA `c9a0ccce...`;
- PR #28 — first consolidated handoff, merge SHA `296870fb...`;
- PR #29 — pending-only approval queue + squash/rebase branch cleanup, merge SHA `525bec1d...`.

### Superseded/closed without merge

- PR #7 — superseded deployment design;
- PR #26 — dirty stacked Phase 2.1D branch, superseded by clean PR #27.

### Open and not merged

- PR #23 — Agent Runtime foundation, detailed in section 11.

---

## 8. Canonical phase status — audited

### Phase 0 — Core Controller

Status: `COMPLETED`

Delivered:

- Worker/PWA;
- ChatGPT Actions/OpenAPI;
- Claude MCP;
- project registry;
- repository read/write;
- approval;
- Git delivery;
- CI/deploy foundation.

### Phase 1 — Repository Stabilization

Status: `COMPLETED`

Delivered:

- OpenAPI regression guard;
- branch list/compare/delete;
- SHA-pinned deletion approval;
- cleanup workflow/UI.

### Phase 2 — Project Brain v1

Status: `COMPLETED`

Delivered:

- canonical docs/context;
- project memory search;
- durable development tasks;
- cross-agent handoff;
- Actions/MCP parity.

### Phase 2.1 — Production Integrity & Security Floor

Status: `IN PROGRESS — IMPLEMENTATION MERGED, FORMAL CLOSEOUT PENDING`

#### 2.1A — Source lock and rollback

Status: `COMPLETED`

Evidence:

- deliberate non-main preview isolation passed;
- production remained exact `main` at 100% traffic;
- previous-good rollback/restore rehearsal passed for backend and PWA;
- immutable workflow artifacts/digests recorded.

#### 2.1B — Approval/idempotency/maintenance

Status: `IMPLEMENTED AND OWNER-OBSERVED`

Evidence:

- terminal buttons no longer re-decide operations;
- pending queue cleaned;
- stale approvals `0`;
- Maintenance Center identified `16` merged branches;
- owner bulk-cleaned them;
- cleanup result `0` merged branches.

Formal documentation still needs synchronized closeout status.

#### 2.1C — Auth/rate/redaction/audit

Status: `MERGED AND DEPLOYED IN LAST VERIFIED RUNTIME`

Delivered:

- auth coverage matrix;
- route-specific request envelopes;
- owner/unauthorized rate profiles;
- origin policy foundation;
- secret redaction;
- persistent bounded audit storage/export;
- token rotation/security runbooks;
- tests.

Remaining beyond foundation:

- per-client identity/scoped capability or OAuth;
- distributed/global rate limiting;
- request body stream enforcement instead of relying only on header/envelope path;
- fully strict production CORS migration evidence;
- tamper-evident append-only evidence service.

#### 2.1D — Critical-path protection

Status: `MERGED; CLOSEOUT EVIDENCE INCOMPLETE`

Delivered:

- `BC-R31` canonical source;
- `BC-R32` security/auth;
- `BC-R33` workflows/release;
- `BC-R34` deploy/runtime;
- `BC-R35` dependency/build control;
- `BC-R30` ordinary;
- shared `createApproval()` enforcement;
- exact rule/path reason;
- Critical Path Conformance workflow;
- tests/typecheck/CI green before merge.

Still required for package exit:

1. current production source verify after latest `main`;
2. live canary staging:
   - ordinary file → normal risk;
   - critical file → high risk + exact rule/path;
3. canary operations delivered биш, reject/cancel/supersede cleanup;
4. formal `ROADMAP` + `PROJECT_STATUS` + decision/status closeout PR.

### Phase 3 — Mobile Trust UX & Release Control

Status: `NEXT — NOT STARTED AS A COMPLETE PACKAGE`

Existing foundation:

- current source/SHA card;
- stale cache clear/reload path;
- terminal approval status;
- maintenance UI.

Not implemented:

- frontend/backend API schema compatibility contract;
- stale-tab mismatch detector;
- explicit service-worker update state machine;
- update-available banner;
- safe cache migration state/version;
- offline recovery UX;
- semantic owner decision card;
- release history chain;
- owner-facing one-tap rollback request and post-rollback incident UX.

### Phase 4 — Mission Control & Second Brain v2

Status: `TARGET; PR #23 PARTIAL FOUNDATION NOT MERGED`

Missing:

- Mission/Goal/AcceptanceCriterion/Decision schema;
- mission lifecycle;
- one active writer lease/heartbeat;
- pause/resume/cancel/recovery;
- Context Packet hash/version;
- structured Owner Intent/Project Brain/World Evidence;
- Asset Graph;
- explicit remember/forget/retention/export UX.

### Phase 5 — Web Research Agent v1

Status: `TARGET / NOT IMPLEMENTED`

Missing:

- search adapter;
- safe source reader;
- source/claim/contradiction schema;
- citations/freshness/jurisdiction;
- research dossier/export;
- browser run safety.

### Phase 6 — Professional Creation Workspace & Diagnostics

Status: `PARTIAL FOUNDATION / MAIN PRODUCT WORK NOT IMPLEMENTED`

Existing:

- Chat/Files/Changes/Preview/Settings tabs;
- local workspace/import;
- preview foundation.

Missing:

- real repository tree;
- tabs/breadcrumb/search;
- rename/move/conflict/unsaved status;
- package-aware professional preview;
- console/network/runtime diagnostic evidence;
- source map file/line;
- screenshot/DOM snapshot;
- bounded diagnose/patch/test repair loop.

### Phase 7 — Secure Runtime & Terminal

Status: `TARGET / NOT IMPLEMENTED`

Missing:

- isolated ephemeral container/VM;
- dependency install/runtime process;
- command policy;
- CPU/RAM/disk/time/egress limits;
- streaming terminal;
- secret just-in-time mount;
- destroy/cleanup proof.

### Phase 8 — Provider Quality, Routing & Economics

Status: `TARGET / NOT IMPLEMENTED`

Missing:

- provider capability registry;
- quality/cost/latency evaluation;
- bounded provider router;
- per-task budget;
- fallback policy and benchmark evidence.

### Phase 9 — Real-world Creation Modes

Status: `TARGET / NOT IMPLEMENTED`

Missing:

- Engineering Assist;
- Diagnose & Repair;
- Sourcing/research workflows;
- personal automation;
- document/media pipelines;
- qualified/safety sign-off gates.

### Phase 10 — Asset Vault, Backup & Migration

Status: `TARGET / NOT IMPLEMENTED`

Missing:

- asset/skill/template graph;
- provenance/license/sensitivity metadata;
- export bundle;
- backup/restore;
- provider portability;
- long-term retention and migration tests.

---

## 9. Canonical document consistency audit

### `docs/ROADMAP.md`

Current issue:

- Phase 2.1B still says owner observation pending;
- 2.1C/2.1D merged/completion state not synchronized;
- cleanup success and exact remaining closeout are not recorded.

Required action:

- separate branch/PR;
- update only factual status and exit evidence;
- do not change canonical phase order.

### `docs/PROJECT_STATUS.md`

Current issue:

- P0 list still says Phase 2.1B maintenance must be merged/deployed;
- says shared token rate protection and critical-path classifier are absent, although PR #25/#27 implemented them;
- next execution order is stale.

Required action:

- update live capability table;
- replace resolved gaps;
- record remaining 2.1D canary/current-runtime verification;
- record PR #29 cleanup evidence;
- record direct-main docs process deviation.

### `docs/SECURITY_OPERATIONS.md`

Current issue:

The document's deliberate exclusions still list some features now partially/fully delivered by PR #25, including audit export/origin/rate foundations.

Required action:

- distinguish delivered foundation from remaining distributed/scoped/tamper-evident target;
- preserve accurate request-limit caveats;
- update owner vs unauthorized rate profiles;
- document SecurityAuditStore retention/export.

### `docs/ARCHITECTURE.md`

Current issue:

- verified foundation list predates rate/audit/critical-path additions;
- overall target architecture remains valid.

Required action:

- minimal factual LIVE/PARTIAL sync only;
- no redesign during closeout.

### Handoff files

- `HANDOFF_NEXT_CHAT.md`: historical;
- `HANDOFF_NEXT_CHAT_V2.md`: superseded by this audit;
- `HANDOFF_NEXT_CHAT_V3.md`: current operational resume source.

---

## 10. Current branch inventory after bulk cleanup

Owner screenshot after Maintenance Center cleanup shows `main` plus four `agent/*` branches.

### 1. `agent/phase-3-agent-runtime-foundation`

```text
head: 6678b85f947a91b50c81a4463c9647569226ee16
PR: #23 open/draft
```

Action: `KEEP UNTIL REVIEW`; do not merge as-is.

### 2. `agent/phase-2-1d-critical-path-foundation`

```text
head: 840d01374758fd4cda84778547a5ba84aa908b2c
PR: #26 closed, not merged, superseded by PR #27
```

Action: compare unique commits to current main; expected `DELETE_SAFE` after confirmation.

### 3. rollback rehearsal branch displayed as `agent/rollback-rehearsal-ap…`

```text
head: abc7aeed68218de63f647a2440a41525239be138
commit: Publish main release outcome
```

Action: resolve exact full branch name read-only; compare unique commits/evidence to main; expected evidence/probe cleanup candidate. **Do not guess branch name and do not delete by prefix.**

### 4. `agent/source-lock-probe-20260719-1`

```text
head: 435535cab8651ffd1193b067246e3eed4362a028
purpose: deliberate non-main production isolation proof
```

Action: canonical evidence is already recorded in main docs; compare unique commits and expected `DELETE_SAFE`.

### Cleanup acceptance

After audit/delete:

```text
main
+ agent/phase-3-agent-runtime-foundation only if PR #23 review intentionally keeps it
+ one active current work branch
```

No branch is deleted only because its name looks old. Required checks:

- no open PR requiring it;
- exact head SHA unchanged;
- unique commits reviewed;
- evidence already captured;
- default/protected guard;
- delete result refreshed in PWA.

---

## 11. PR #23 exact audit

PR title:

```text
Start Phase 3 Agent Runtime foundation
```

State:

```text
open
draft
base SHA: 7012c6bd74308a6b2470fe8179ab303ab4a67c24
head SHA: 6678b85f947a91b50c81a4463c9647569226ee16
commits: 11
```

Canonical classification:

```text
Phase 4 Mission Control & Second Brain v2 foundation
NOT Phase 3 Mobile Trust UX
```

Implemented on branch:

- deterministic task priority ordering;
- dependency graph validation;
- ready/waiting/blocked/running/completed plan;
- duplicate/missing/self/cycle fail-closed checks;
- durable Agent Runtime task API/store;
- capability response explicitly says provider dispatch false;
- tests.

Why it must not merge now:

- branch base is far behind current main;
- title/scope phase classification is outdated;
- Phase 2.1 closeout and Phase 3 gate must not be skipped;
- conflict/security/critical-path integration must be re-reviewed;
- new security/audit/request-limit policy from current main must be preserved.

Recommended handling after Phase 3 gate:

1. fetch current main;
2. list PR #23 changed files/commits;
3. create clean Phase 4 branch from current main;
4. transplant only deterministic planner/task pieces still needed;
5. update naming/docs/schema;
6. add lease/context/idempotency policy integration;
7. run current Test, Validate, Critical Path Conformance;
8. close/supersede PR #23 instead of merging stale history directly.

---

## 12. Security posture and remaining risks

### Current protections

- secrets remain Worker/provider secret stores;
- global Bearer gate for protected routes;
- project allowlist;
- exact SHA/context approvals;
- stable decision idempotency;
- main-only production source lock;
- previous-good rollback;
- request size profiles;
- redaction helpers;
- owner/unauthorized rate profiles;
- persistent security audit/export;
- critical path high-risk classification;
- conformance CI.

### P0/P1 remaining security gaps

1. **Current Git/runtime SHA verification** after `2b52bc9...` direct docs commit.
2. **Repository public visibility owner decision.**
3. **Shared bearer credential** — no device/client identity or scoped capability.
4. **Rate limit is not distributed/global.** Multiple Worker instances do not share exact quota state.
5. **Request limit is not full stream-level enforcement.** Content-Length/envelope is first guard.
6. **Strict CORS production allowlist migration evidence incomplete.**
7. **Audit is bounded operational storage, not tamper-evident append-only Evidence Service.**
8. **GitHub branch protection/ruleset not independently verified in this audit.** App/backend guard exists, but direct admin main commit occurred.
9. **Critical path live canary closeout missing.**
10. **No scoped runner/browser isolation** because those phases are not implemented.

---

## 13. Process deviations and lessons

### Direct `main` docs commit

Commit:

```text
2b52bc9a4c2948225b0fc7f61ba6c0dc1661e6fe
```

Finding:

- created without working branch/PR;
- content is useful and no code change occurred;
- nevertheless violates locked workflow.

Required remediation:

- do not rewrite or force-reset main;
- record deviation in next status/decision update;
- use branch → CI → PR → merge from now on;
- verify whether repository ruleset can reduce accidental direct writes without breaking owner emergency recovery.

### Dynamic identifiers

Do not store an exact SHA in Git docs as permanently “current” because the documenting commit changes main again. Use:

- runtime `/api/release` for current source;
- GitHub main for current Git truth;
- audit files for historical checkpoints only.

---

## 14. Exact next execution sequence

### Package A — Read-only current-state verification

1. Read all canonical files and this handoff.
2. Resolve current GitHub main SHA.
3. Verify backend `/health`.
4. Verify PWA `/api/release`/Settings exact source SHA.
5. Verify protected route unauthorized `401`.
6. Verify authenticated `/api/security/audit` read.
7. Verify repository visibility and branch/ruleset state read-only.
8. Resolve exact four remaining branch names/SHAs.

No mutation in this package.

### Package B — Phase 2.1 live closeout evidence

1. Create a dedicated canary working branch from current main.
2. Stage one ordinary harmless fixture and confirm:
   - `risk: normal`;
   - `BC-R30`/no critical rule.
3. Stage one harmless critical-path fixture and confirm:
   - `risk: high`;
   - exact `critical_path:BC-Rxx`;
   - exact `critical_path_file:<path>`.
4. Do not deliver either canary to production.
5. Reject/cancel/supersede canary operations and verify cleanup.
6. Re-run Test, Validate, Critical Path Conformance.

### Package C — Canonical documentation sync

On one docs-only working branch:

- update `docs/ROADMAP.md` factual status;
- update `docs/PROJECT_STATUS.md`;
- update `docs/SECURITY_OPERATIONS.md`;
- minimal `docs/ARCHITECTURE.md` live foundation sync;
- add Phase 2.1 closeout/status decision record;
- record direct-main process deviation;
- CI → PR → merge → runtime source verification.

Only after A–C can Phase 2.1 be marked `COMPLETED`.

### Package D — Remaining branch/PR cleanup

1. Review unique commits for 3 stale/evidence branches.
2. Delete exact SHA-pinned safe branches.
3. Keep PR #23 branch only until disposition is recorded.
4. Update/close PR #23 as superseded or preserve for later clean transplant.
5. Refresh PWA branch list and Maintenance Center.

### Package E — Phase 3A Version/update contract

Goal:

> Owner утаснаас frontend/backend compatibility, update state, stale tab, offline recovery болон safe reload-ийг нэг дэлгэцээс ойлгоно.

First coherent implementation package:

- release/API schema version contract;
- frontend/backend compatibility response;
- stale-tab mismatch detector;
- service-worker update state machine;
- update available/ready/applying/failed UI;
- one-time safe reload loop guard;
- cache schema migration;
- offline recovery message;
- iOS installed-PWA checklist;
- regression tests;
- owner-visible evidence.

Do not jump to editor, terminal, research, provider router, multi-user or Agent Runtime merge before this gate.

### Package F — Phase 3B/3C

After 3A exit evidence:

- semantic approval card;
- current/previous release history;
- rollback request UI;
- post-rollback smoke/incident note.

### Package G — Phase 4 preparation

Only after Phase 3:

- clean transplant/rebuild of useful PR #23 planner;
- Mission schema/lifecycle;
- lease/heartbeat;
- Context Packet;
- structured Second Brain;
- Asset Graph.

---

## 15. Owner action boundary

AI/assistant өөрөө үргэлжлүүлэх зүйл:

- repository audit/read;
- branch creation;
- code/docs changes;
- tests/CI diagnostics and repair;
- PR creation;
- green-CI merge when owner has explicitly authorized package delivery;
- post-merge public/read-only smoke;
- safe cleanup plan.

Owner action/explicit decision шаардах зүйл:

- secret/token value;
- billing/payment;
- external account login;
- repository public → private visibility decision;
- irreversible/high-risk production mutation;
- rollback rehearsal/live traffic switch;
- specialist/safety-critical sign-off.

Owner-оор GitHub/Cloudflare-ийн энгийн давтагдсан алхам хийлгэхгүй.

---

## 16. Ажиллах хатуу дүрэм

Owner `үргэлжлүүл` гэж бичвэл:

1. current package-ийг дуусгана;
2. blocker-ийг өөрөө оношилж засна;
3. CI унавал logs уншиж засварлаад дахин шалгана;
4. жижиг алхам бүрт чат бичүүлж approval нэхэхгүй;
5. package дуусмагц дараагийн package руу шууд орно;
6. зөвхөн secret, payment, permission, irreversible external action эсвэл бодит product decision дээр зогсоно;
7. provider evidence-гүйгээр deploy/production verified гэж зарлахгүй;
8. main/master direct write хийхгүй;
9. critical path change бүр exact rule/path evidence + high-risk policy дагана;
10. fake completion, guessed branch name, guessed deployment state хориглоно;
11. тайланг монгол кириллээр, товч боловч factual өгнө;
12. one coherent package бүрт branch → diff/tests → PR → CI → merge → evidence дараалал хэрэглэнэ.

---

## 17. Шинэ chat-д өгөх эхний prompt

```text
GitHub repository `enkhbat194/best-code-ide` доторх `docs/HANDOFF_CURRENT.md` болон түүнээс заасан `docs/HANDOFF_NEXT_CHAT_V3.md`-г эхлээд бүрэн унш.

Дараа нь handoff-ийн canonical дарааллаар `BESTCODE_MASTER.md`, `docs/DECISIONS/BC-036-canonical-roadmap-lock.md`, `docs/ROADMAP.md`, `docs/PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, evidence/threat/security/critical-path файлуудыг унш.

Эхлээд GitHub current main ба production runtime SHA-г read-only байдлаар баталгаажуул. Handoff-д бичсэн `2b52bc9...` нь audit эхлэх үеийн Git checkpoint, `525bec1d...` нь хамгийн сүүлд owner-оор батлагдсан runtime checkpoint болохоос merge-ийн дараах current гэж бүү таамагла.

Би `үргэлжлүүл` гэж бичихэд:
1. Package A current-state verification;
2. Package B Phase 2.1 live canary closeout;
3. Package C canonical docs sync;
4. Package D branch/PR cleanup;
5. Package E Phase 3A Version/update contract
гэсэн дарааллаар жижиг алхам бүрд надаас command нэхэлгүй ажилла.

Main/master direct write бүү хий. Blocker/CI failure-ийг өөрөө зас. Secret, payment, repository visibility, irreversible production action шаардлагатай үед л зогсоо.
```

---

## 18. Resume

```text
үргэлжлүүл
```
