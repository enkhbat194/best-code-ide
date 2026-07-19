# BestCode — Architecture

Master: `/BESTCODE_MASTER.md` v2.0.0 (`LOCKED`)

## 1. Architecture objective

BestCode нь AI model өөрөө биш. Энэ нь owner-ийн intent, canonical memory, policy, evidence, execution, approval, asset ownership-ийг provider-уудаас салгасан control plane юм.

```text
Owner on phone
  ↓ intent / decision / observation
BestCode Mission Canvas
  ↓ scoped mission context
Orchestrator + Policy/Evidence Gate
  ├─ AI role adapters
  ├─ Research/browser plane
  ├─ GitHub/CI/release plane
  ├─ Runner/preview plane
  └─ Brain/Asset storage
```

## 2. Status legend

- **LIVE** — production code and evidence exists.
- **PARTIAL** — foundation exists, target contract incomplete.
- **TARGET** — planned architecture, not yet production claim.

## 3. Current production topology — LIVE

```text
ChatGPT Actions ─┐
Claude MCP ──────┼─> BestCode Cloudflare Worker
BestCode PWA ────┘          │
       └─ DeepSeek API       ├─ Durable Object approval/task/handoff
                             ├─ GitHub repository/PR/workflows
                             └─ Cloudflare frontend deployments
```

### Production endpoints

- Backend: `https://best-code-ide.enkhbat194.workers.dev`
- Installed PWA: `https://best-code-ide-appl.enkhbat194.workers.dev`
- Manual frontend target: `https://best-code-ide-app.enkhbat194.workers.dev`

### Verified foundation

- Bearer auth on protected Worker routes;
- server-side GitHub/DeepSeek secrets;
- project allowlist;
- read tools and staged approval-gated repository writes;
- Durable Object terminal approval state, decision idempotency, TTL болон stale-context invalidation;
- prepared commit → safe branch push → workflow → PR tools;
- Project Brain canonical context/search;
- durable development task and handoff;
- ChatGPT Actions/OpenAPI and MCP share executor/policy.

## 4. Target logical layers

### Layer A — Experience

#### Mission Canvas — TARGET

- multimodal intent capture: text, voice, image, file, URL;
- goal + done criteria + constraints confirmation;
- mission timeline and current lease/agent;
- semantic decision cards;
- result/use/observation loop.

#### Workspace — PARTIAL

- Chat/Files/Changes/Preview/Settings currently exist;
- target: real tree, tabs, search, conflict, coherent artifact change set;
- code details remain available but are not primary owner decision language.

#### Asset Vault — TARGET

- apps, reports, designs, datasets, templates, skills, decisions;
- provenance, version, license, sensitivity, verification, reuse graph;
- open export and restore.

### Layer B — Mission Orchestration

#### Mission Service — TARGET

Durable mission graph:

```text
Mission
 ├─ Tasks with dependency edges
 ├─ Operations with idempotency/approval
 ├─ Decisions
 ├─ Evidence
 └─ Assets
```

Cloudflare Workflows эсвэл equivalent durable workflow engine нь pause/resume, retry, wait-for-approval, timeout, cancellation, compensation ашиглана. Durable Object нь coordination/lease; workflow history нь long-running progression-д ашиглагдана.

#### Task Lease — TARGET

- owner/project/task scoped;
- one active writer;
- lease TTL + heartbeat;
- stale recovery;
- cross-agent handoff context hash;
- parallel read/review task зөвшөөрнө.

### Layer C — Policy & Evidence Gate

#### AuthN/AuthZ — PARTIAL → TARGET

Current shared Bearer auth нь foundation. Target:

- client/device/provider identity;
- short-lived scoped capability;
- project/mission namespace;
- revocation/rotation;
- rate/replay/idempotency;
- critical re-auth/owner confirmation.

#### Approval coordination — PARTIAL

- `pending_approval → approved | rejected | expired | superseded` decision boundary;
- exact decision replay нь ижил idempotency key-ээр state дахин өөрчлөхгүй;
- file/branch/deployment operation нь approved base/context SHA-тай pin хийгдэнэ;
- stale context external write/dispatch-аас өмнө operation-ийг `superseded` болгоно;
- PWA terminal status, TTL, context SHA харуулж decision товчийг disable хийнэ;
- target gap: full semantic evidence card, capability identity, append-only decision audit,
  generic execution lease/compensation.

#### Risk engine — TARGET

Input:

- capability;
- target/path class;
- base/context hash;
- data sensitivity;
- external side effect;
- safety domain;
- blast radius;
- cost;
- reversibility.

Output: auto, notice, semantic approval, independent review, specialist gate, deny.

#### Evidence Service — TARGET

Trusted producer-оос append-only evidence event авч:

- checksum/integrity;
- artifact reference;
- acceptance mapping;
- redaction;
- validity/supersession;
- release/rollback chain хадгална.

Schema: `/docs/EVIDENCE_STANDARD.md`.

### Layer D — Second Brain & Asset Graph

#### Canonical Git memory — LIVE

- `BESTCODE_MASTER.md`;
- `docs/PROJECT_STATUS.md`;
- `docs/ARCHITECTURE.md`;
- `docs/ROADMAP.md`;
- `docs/DECISIONS/**`;
- policy/standard docs.

#### Dynamic project memory — PARTIAL

Durable Object-д task, handoff, approval байна. Target-д Mission, Operation, Evidence metadata, Decision event нэмэгдэнэ.

#### Personal memory — TARGET

Git repository-д хийхгүй. Private owner-controlled store, explicit retention, sensitivity, export/delete, minimal Context Packet ашиглана.

#### World evidence — TARGET

Source, Claim, contradiction, dossier, snapshot hash. Search index/vector нь derived бөгөөд canonical source биш.

#### Asset Graph — TARGET

Recommended entity relations:

```text
Goal ─owns→ Mission ─produces→ Asset
Mission ─uses→ Source/Claim
Mission ─contains→ Task/Operation
AcceptanceCriterion ─proved_by→ Evidence
Asset ─derived_from→ Asset/Source
Decision ─governs→ Mission/Project
Skill ─reused_by→ Mission
```

### Layer E — Execution planes

#### GitHub plane — LIVE/PARTIAL

- repository truth, branch, PR, CI;
- target release controller only approved `main` SHA-г production-д нэвтрүүлнэ;
- non-main preview тусдаа hostname/environment;
- branch integration active traffic-ийг default-аар хориглоно.

#### Local/PWA plane — PARTIAL

- IndexedDB workspace;
- local Preview, console capture;
- DeepSeek `/api/llm` loop;
- target diagnostics snapshot болон repository-aware mission integration.

#### Runner plane — TARGET

- one ephemeral container/VM per task/workspace;
- source checkout by SHA;
- bounded install/build/test/process;
- egress, command, secret, resource policy;
- log/event streaming;
- destroy and artifact export.

Cloudflare Containers is a candidate, not canonical requirement. Adapter contract allows another secure runner.

#### Browser plane — TARGET

- public research acquisition;
- visual/e2e preview testing;
- owner-assisted authenticated session;
- screenshot/markdown/accessibility snapshot;
- domain/action/budget isolation.

Cloudflare Browser Run is a candidate implementation. CAPTCHA/access control bypass is forbidden.

#### AI provider plane — PARTIAL

- ChatGPT Actions/MCP/DeepSeek current integrations;
- target provider adapter reports capabilities, model/version, privacy class, cost/latency;
- role router chooses provider but policy remains outside provider;
- no provider memory is canonical.

## 5. Storage strategy — target

| Data | Preferred shape | Requirement |
|---|---|---|
| Canonical code/docs | GitHub | version history, PR, export |
| Task/lease/approval | Durable coordination store | consistency, TTL, namespace |
| Mission/claim/asset metadata | queryable relational store | schema, relation, export |
| Artifact/snapshot/log | object storage | checksum, retention, ACL |
| Search/vector index | derived index | rebuildable, not canonical |
| Secrets | provider secret store | never model/memory/artifact |

Specific vendor/storage decision бүр ADR болон migration/export plan-тай байна.

## 6. Context Packet

AI-д бүх history өгөхгүй. Task-scoped packet:

```yaml
mission:
  goal: string
  done_when: []
  constraints: []
  exclusions: []
project:
  id: string
  canonical_sha: string
  relevant_decisions: []
task:
  id: string
  role: string
  lease: string
  capability: []
  budget: {}
inputs:
  artifact_refs: []
  source_claim_refs: []
evidence_required: []
policy_version: string
context_hash: sha256:...
```

Packet нь provider response бүрт echo хийх secret агуулахгүй. Handoff болон approval context hash-аар pin хийгдэнэ.

## 7. Operation flow

### Software change

```text
Intent contract
→ canonical context
→ agent branch
→ inspect/plan
→ staged coherent change
→ tests/preview/review
→ semantic approval
→ safe commit/push/PR
→ CI
→ merge main
→ release approval
→ deploy exact main SHA
→ smoke + active traffic assertion
→ observe + asset package
```

### Research mission

```text
Question/decision contract
→ search adapters
→ safe source acquisition
→ claims/provenance
→ cross-check/contradictions
→ safety/specialist gate
→ dossier approval
→ asset archive + freshness policy
```

### External transaction — future

```text
Research/plan
→ owner-visible exact transaction preview
→ re-check price/target/current session
→ just-in-time owner approval
→ execute once
→ receipt/evidence
→ no silent retry on ambiguous result
```

## 8. API design rules

- Tool name describes one bounded intent.
- Read and write capability тусдаа.
- Public arbitrary fetch/command endpoint байхгүй.
- Input project/mission scope explicit; write-д default project ашиглахгүй.
- Every mutation accepts idempotency key and expected version/hash.
- Response envelope: `ok`, `operation_id`, `status`, `result|error`, `evidence_refs`, `next_action`.
- Error нь retryable эсэх, violated rule ID, owner action шаардлагатай эсэхийг хэлнэ.
- Tool annotations hint биш; server-side policy authoritative.
- OpenAPI/MCP/PWA executor нэг business policy ашиглана.

## 9. Observability

Mission timeline нь technical trace-ийг owner-level event болгож харуулна:

- task/role/provider start/stop;
- capability grant/deny;
- approval/waiver;
- source acquired/blocked;
- cost/latency/budget;
- test/review conclusion;
- release/traffic/rollback;
- error/retry/cancel.

Metrics нь privacy-safe, project-scoped байна. Model chain-of-thought хадгалахгүй; action rationale ба evidence хадгална.

## 10. Architecture invariants

1. GitHub `main` software truth хэвээр.
2. AI/provider canonical state эзэмшихгүй.
3. Dynamic metadata system evidence-ийг орлохгүй.
4. Non-main production traffic авахгүй.
5. Secret untrusted plane руу очихгүй.
6. One task/one writer lease.
7. Critical operation exact approval + evidence + rollback.
8. External content instruction биш.
9. Personal, project, world data boundary тусдаа.
10. Canonical data open export-тай.
