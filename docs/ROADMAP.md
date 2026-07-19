# BestCode — Execution Roadmap

Master: `/BESTCODE_MASTER.md` v2.0.0 (`LOCKED`)

Энэ roadmap нь phase нэрсийн жагсаалт биш. Phase бүр **owner outcome, scope, dependency, exit evidence, deliberate exclusion**-тэй байна. Бүх ажлыг нэгэн зэрэг эхлүүлэхгүй; өмнөх gate ногоон болсны дараа дараагийн autonomous power нээгдэнэ.

## 1. Prioritization rule

Дарааллыг дараах байдлаар эрэмбэлнэ:

1. production integrity ба owner safety;
2. owner-д үр дүн/эрсдэл ойлгуулах trust UX;
3. durable mission/memory/evidence foundation;
4. read/research capability;
5. bounded build/run capability;
6. broader real-world autonomy;
7. polish ба scale.

Шинэ AI/provider нэмэх нь өөрөө priority биш. Owner outcome эсвэл reliability-г хэмжигдэхүйц сайжруулах үед л нэмнэ.

---

## Phase 0 — Core controller — COMPLETED

### Delivered

- Cloudflare backend Worker ба frontend PWA;
- ChatGPT Actions/OpenAPI ба Remote MCP;
- DeepSeek server-side provider access;
- project registry/allowlist;
- repository read/search;
- staged safe write, approval, commit/push/PR;
- GitHub Actions build/test/deploy tool foundation.

### Evidence

- production endpoints reachable;
- protected routes reject missing/invalid Bearer token;
- repository policy tests.

---

## Phase 1 — Repository stabilization — COMPLETED

### Delivered

- OpenAPI description bound/regression tests;
- branch list/compare/delete;
- SHA-pinned high-risk branch deletion approval;
- obsolete PR/branch cleanup workflow.

### Lesson

UI дээр terminal approval state-ийг зөв тусгах хэрэгтэй. Approved deletion operation-д дахин decision илгээхэд error гарсан нь semantic state UX шаардлагатайг харуулсан.

---

## Phase 2 — Project Brain v1 — COMPLETED

### Delivered

- Master v1 foundation;
- canonical Status/Architecture/Roadmap/Decision docs;
- `project_context_get`, `project_memory_search`;
- durable task start/list/get/update;
- cross-agent handoff record/list;
- ChatGPT Actions/MCP parity;
- Project Brain tests;
- PR #12 merge, production health `project-brain-v1`.

### Limitation

Энэ нь structured Personal Brain/Asset Graph биш. Current task status нь development workflow-д зориулсан v1 schema.

---

## Phase 2.1 — Production Integrity & Security Floor — NEXT / P0

### Owner outcome

“Миний approve хийгээгүй branch production болохгүй. Яг ямар version ажиллаж байгааг харж, алдаа гарвал буцааж чадна.”

### Work package 2.1A — Deployment source lock

- Cloudflare Git integration-ийн production branch rule-ийг audit;
- `main`-ээс бусдыг preview-only environment/hostname болгох;
- active deployment metadata endpoint: source branch, commit SHA, version ID, deployed_at;
- release controller exact approved main SHA allowlist;
- source mismatch detector + traffic stop/rollback;
- production smoke нь expected SHA шалгана;
- deploy workflow/documentation нэг source of truth болно.

**Exit evidence:** agent branch зориудаар deploy trigger хийсэн ч production active SHA өөрчлөгдөхгүй; main release болон rollback test ногоон.

### Work package 2.1B — Approval/idempotency fix

- terminal approval state UI;
- approved/rejected/expired operation buttons disable;
- idempotency key mutation бүрт;
- replay/duplicate approval negative tests;
- stale base/context invalidation;
- approval TTL ба owner-visible expiry.

**Exit evidence:** screenshot/e2e + duplicate request нэг side effect үүсгээгүй test.

### Work package 2.1C — Auth/rate/redaction foundation

- existing Bearer path бүрийн auth coverage inventory;
- token rotation runbook;
- per-IP/client bounded rate and request size/time limit;
- log/diagnostics/evidence redaction library + fixtures;
- strict CORS/origin review;
- audit event export;
- future scoped capability/OAuth ADR.

**Exit evidence:** auth matrix, rate-limit test, canary secrets бүх output-оос redacted.

### Work package 2.1D — Critical-path protection

- path class classifier: Master/decisions, auth, `.github/workflows`, deploy config, dependency lock/config;
- core/critical review requirement;
- policy rule ID error;
- conformance suite CI workflow;
- incident runbook ба severity.

### Deliberately excluded

- шинэ editor feature;
- general web browser;
- remote terminal;
- олон user.

---

## Phase 3 — Mobile Trust UX & Release Control

### Owner outcome

“Утсан дээр update орсон эсэх, юу өөрчлөгдсөн, аюултай эсэх, буцаах арга нь шууд ойлгогдоно.”

### 3A — Version/update contract

- frontend/backend build metadata;
- UI footer/settings release version + source SHA;
- service worker update available banner;
- install/activate/reload UX;
- stale-tab/API schema mismatch protection;
- offline recovery and cache migration.

### 3B — Semantic approval

- goal/outcome/verification/sources/impact/risk/cost/rollback card;
- advanced diff/evidence drawer;
- one coherent change set;
- critical reviewer/waiver display;
- accessible Mongolian copy.

### 3C — Release history & rollback

- current/previous-good release card;
- release → CI → SHA → deployment evidence chain;
- one-tap rollback request + high-risk confirmation;
- post-rollback smoke and incident note.

### Verification matrix

- iPhone Safari browser;
- installed iOS PWA;
- Android/desktop smoke when available;
- online/offline/update/stale tab;
- production mismatch simulation.

**Exit evidence:** owner нэг screenshot/card-аас current SHA/version, change, verification, rollback-ийг тайлбарлаж чадна; bad release rollback rehearsal passes.

---

## Phase 4 — Mission Control & Second Brain v2

### Owner outcome

“Би зорилгоо нэг удаа хэлнэ. Ямар AI үргэлжлүүлсэн ч буруу ойлголтгүй, ажлын явц ба дараагийн шийдвэр нэг газар байна.”

### 4A — Mission schema/API

- Mission, Goal, AcceptanceCriterion, Decision, Task, Operation IDs;
- captured/framing/planned/executing/verifying/decision/completed/packaged lifecycle;
- dependency graph;
- pause/resume/cancel/recover;
- one active writer lease + heartbeat;
- context hash/version.

### 4B — Mission Canvas

- text/voice/image/file/URL intent capture;
- AI understanding confirmation;
- done criteria editor;
- progress timeline, agent/role/lease;
- “Needs your decision” inbox;
- next most valuable action.

### 4C — Structured Second Brain

- Owner Intent, Project Brain, World Evidence namespaces;
- stable object/relationship schema;
- explicit “remember/don't remember” UX;
- sensitivity/retention;
- minimal Context Packet generator;
- keyword search first; vector index only derived.

### 4D — Asset Graph v1

- Artifact/Asset/Skill/Template metadata;
- derived-from/reused-by links;
- Markdown/JSON/file bundle export;
- project/asset backup and restore test.

### Migration

- v1 development tasks remain readable;
- canonical docs remain Git-based;
- v1 handoffs map to new Mission/Task;
- no silent memory import from chat transcripts.

**Exit evidence:** ChatGPT starts a Mission, Claude resumes from Context Packet, DeepSeek receives only scoped diagnostics, owner sees same goal/evidence; no chat copy/paste.

---

## Phase 5 — Web Research Agent v1

### Owner outcome

“Материал, технологи, алдаа, supplier судлуулахад линкний бөөгнөрөл биш, шалгагдсан claim, зөрчил, үнэ/огноо, дараагийн шийдвэртэй dossier авна.”

### 5A — Research contract/schema

- ResearchQuestion/Decision/Scope;
- Source/Claim/Contradiction;
- source tier, freshness, jurisdiction;
- dossier/export;
- research lifecycle and cancellation.

### 5B — Safe search adapter

- provider-neutral interface;
- provider evaluation harness;
- query locale/language/date/domain;
- budget/quota/cache;
- search result provenance.

Provider сонголт production experiment/eval-ээр шийдэгдэнэ; Master-д үнэ hard-code хийхгүй.

### 5C — Safe source reader

- HTTP(S), URL normalization;
- private IP/metadata/redirect/DNS protection;
- markdown-first direct fetch;
- bounded HTML extraction;
- content hash;
- prompt-injection flag;
- copyright/retention policy.

### 5D — Browser Run adapter

- dynamic page snapshot/markdown;
- domain/page/time/download cap;
- visual source open;
- no login/CAPTCHA bypass;
- owner-assisted session design (read-only prototype).

### 5E — Research UX

- source card;
- claim/source graph;
- contradiction/uncertainty banner;
- refresh expired claims;
- specialist-required block;
- cost progress and stop.

### Dogfood missions

1. BestCode-ийн бодит dependency/debugging research.
2. Нэг материал/тоног төхөөрөмжийн sourcing dossier.
3. Нэг инженерийн preliminary question — qualified review gate зөв ажиллах test.

**Exit evidence:** material claims 100% citation, two-source cross-check rule, malicious page injection test, SSRF suite, budget stop, exportable dossier.

---

## Phase 6 — Professional Creation Workspace & Diagnostics

### Owner outcome

“AI-ийн хийсэн файлыг утаснаас олж, preview-д ажиллуулж, алдааг context-тэй нь AI-д өгч засуулахад editor-ийн мэргэжил шаардахгүй.”

### 6A — Workspace

- real repository tree;
- tabs/breadcrumb/search;
- create/rename/move/delete;
- Git status, unsaved/conflict;
- large file/binary guard;
- mobile gestures and keyboard.

### 6B — Preview matrix

- static web;
- React/TS bundle;
- Python bounded preview;
- package/import policy;
- viewport/device modes;
- shareable temporary preview.

### 6C — Diagnostics pipeline

- console/runtime/network/build events;
- source map/file/line;
- screenshot/DOM snapshot;
- secret/PII redaction;
- diagnostics evidence/context packet;
- DeepSeek bounded diagnose/patch proposal;
- external reviewer access through same scoped tools.

### 6D — Repair loop

```text
observe error → reproduce → hypothesis → minimal patch
→ test/preview → compare → owner approval if needed → evidence
```

Max attempts, failure memory, rollback, cost cap шаардлагатай.

**Exit evidence:** selected representative projects дээр error capture→AI repair→green preview flow, fake-successгүй.

---

## Phase 7 — Secure Remote Runtime

### Owner outcome

“Утас өөрөө хүчтэй компьютер байх шаардлагагүй; BestCode тусгаарлагдсан орчинд build/test/preview хийгээд үр дүнг утсанд stream хийнэ.”

### 7A — Runner contract

- image/runtime selection;
- exact source SHA checkout;
- file sync/artifact upload;
- command allow/risk classification;
- process/port/log API;
- cancel/timeout/cleanup;
- evidence producer identity.

### 7B — Sandbox security

- VM/container isolation;
- ephemeral filesystem;
- secret just-in-time mount;
- egress policy;
- CPU/RAM/disk/process/time quota;
- dependency lifecycle control;
- no host control socket;
- abuse/anomaly kill switch.

### 7C — Mobile terminal

- command plan before execute;
- safe presets first;
- streaming output, search/copy;
- dangerous command semantic approval;
- reconnect/resume;
- no secret echo.

**Exit evidence:** malicious package/fork bomb/egress/secret fixtures contained; runner destroyed; artifact checksum retained.

---

## Phase 8 — Multi-agent Quality & Economics

### Owner outcome

“Ажилд тохирсон AI автоматаар сонгогдож, чухал өөрчлөлтийг өөр AI шүүж, нэг provider ажиллахгүй байсан ч project зогсохгүй.”

### Scope

- logical role router;
- provider capability registry;
- independent reviewer packets;
- provider failure/fallback;
- privacy/cost/latency/quality routing;
- task-level budget;
- eval/replay dataset;
- reviewer disagreement resolution;
- owner waiver workflow.

### Eval dimensions

- acceptance pass rate;
- defect escape;
- hallucinated tool/evidence rate;
- context drift;
- cost/latency;
- source quality;
- repair attempts;
- owner intervention count.

**Exit evidence:** same benchmark missions across providers; routing improves outcome/cost; critical injected defect independent review catches.

---

## Phase 9 — Real-world Creation Modes & Asset Vault

### Owner outcome

“BestCode надад app-аас гадна бодит амьдралын судалгаа, зураг төслийн input, sourcing, засвар, automation, баримт бүтээж өгөөд бүгдийг дахин ашиглагдах хөрөнгө болгоно.”

### 9A — Engineering Assist

- requirement/constraint capture;
- units/material/standard edition;
- calculation trace and assumptions;
- preliminary BOM/CAD exchange artifact;
- failure mode/safety checklist;
- qualified review/sign-off record.

### 9B — Sourcing & Procurement Assist

- specification normalizer;
- supplier/quote comparison;
- currency/tax/shipping/time basis;
- seller/marketplace risk;
- owner-approved RFQ/message/order only;
- no autonomous payment initially.

### 9C — Diagnose & Repair

- observation/photo/manual/part context;
- fault tree;
- safe test sequence;
- stop condition;
- parts/tools list;
- post-repair observation.

### 9D — Personal Automation

- connector capability/recipient resolution;
- dry-run;
- external message/action preview;
- schedule/condition;
- audit/undo/kill switch.

### 9E — Asset Vault mature

- reusable skill/template/component/dossier;
- dependency/provenance/license;
- portfolio and owner value report;
- reuse suggestions;
- obsolete/refresh policy.

**Exit evidence:** owner-ийн гурван real-life asset project safely completed and later reused.

---

## Phase 10 — Resilience, Portability & Legacy

### Owner outcome

“Нэг AI, cloud, account, утас алга болсон ч миний бүтээл ба санах ой надад үлдэж, сэргээгдэнэ.”

### Scope

- encrypted backup and key recovery design;
- open Markdown/JSON/Git/artifact export;
- full restore drill;
- provider adapter replacement drill;
- storage/cloud migration drill;
- integrity scan/checksum repair;
- retention and deletion report;
- long-term version/format migration;
- emergency read-only mode.

**Exit evidence:** clean environment-д backup-аас canonical docs, mission, evidence, asset-ыг сэргээж, нэг project build хийсэн.

---

## 2. Dogfood portfolio — roadmap-ийг бодит болгох

Feature бүр BestCode өөр дээрээ болон owner-ийн бодит project дээр шалгагдана.

| Mission | Юуг батлах вэ? |
|---|---|
| BestCode release/update | software build, CI, semantic approval, rollback |
| Czech–Mongolian app improvement | cross-project isolation, reusable skill, mobile delivery |
| Material/equipment sourcing dossier | multilingual research, price freshness, supplier evidence |
| Steel structure preliminary pack | engineering assumptions, standard/jurisdiction, specialist gate |
| DIY machine diagnosis/design pack | community evidence + physical safety boundary |

Dogfood mission амжилтгүй бол шинэ feature нуухгүй; failure evidence roadmap priority-г өөрчилнө.

## 3. Release train

Том phase-ийг олон сар хүлээхгүй. Work package бүр:

```text
contract → branch → implementation → tests/review
→ owner semantic approval → PR/CI → main
→ controlled release → smoke/rollback evidence
→ status/asset update
```

Нэг чатанд аль болох нэг үнэ цэнтэй coherent package бүрэн дуусгана. Хэрэглэгчид GitHub/Cloudflare-ийн давтагдсан алхам шилжүүлэхгүй.

## 4. Stop/go rule

Дараагийн phase руу орохгүй нөхцөл:

- production source mismatch нээлттэй;
- security P0 unresolved;
- rollback proof байхгүй;
- fake/stale evidence incident;
- owner outcome dogfood дээр батлагдаагүй;
- зардлын cap тодорхойгүй;
- safety-critical gate тойрогдсон.
