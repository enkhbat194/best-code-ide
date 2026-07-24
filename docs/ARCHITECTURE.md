# BestCode â€” Architecture

Master: `/BESTCODE_MASTER.md` v2.0.0 (`LOCKED`)

## 1. Architecture objective

BestCode Ð½ÑŒ AI model Ó©Ó©Ñ€Ó©Ó© Ð±Ð¸Ñˆ. Ð­Ð½Ñ Ð½ÑŒ owner-Ð¸Ð¹Ð½ intent, canonical memory, policy, evidence, execution, approval, asset ownership-Ð¸Ð¹Ð³ provider-ÑƒÑƒÐ´Ð°Ð°Ñ ÑÐ°Ð»Ð³Ð°ÑÐ°Ð½ control plane ÑŽÐ¼.

```text
Owner on phone
  â†“ intent / decision / observation
BestCode Mission Canvas
  â†“ scoped mission context
Orchestrator + Policy/Evidence Gate
  â”œâ”€ AI role adapters
  â”œâ”€ Research/browser plane
  â”œâ”€ GitHub/CI/release plane
  â”œâ”€ Runner/preview plane
  â””â”€ Brain/Asset storage
```

## 2. Status legend

- **LIVE** â€” production code and evidence exists.
- **PARTIAL** â€” foundation exists, target contract incomplete.
- **TARGET** â€” planned architecture, not yet production claim.

## 3. Current production topology â€” LIVE

```text
ChatGPT Actions â”€â”
Claude MCP â”€â”€â”€â”€â”€â”€â”¼â”€> BestCode Cloudflare Worker
BestCode PWA â”€â”€â”€â”€â”˜          â”‚
       â””â”€ DeepSeek API       â”œâ”€ Durable Object approval/task/handoff
                             â”œâ”€ GitHub repository/PR/workflows
                             â””â”€ Cloudflare frontend deployments
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
- Durable Object terminal approval state, decision idempotency, TTL Ð±Ð¾Ð»Ð¾Ð½ stale-context invalidation;
- prepared commit â†’ safe branch push â†’ workflow â†’ PR tools;
- Project Brain canonical context/search;
- durable development task and handoff;
- ChatGPT Actions/OpenAPI and MCP share executor/policy.

## 4. Target logical layers

### Layer A â€” Experience

#### Mission Canvas â€” TARGET

- multimodal intent capture: text, voice, image, file, URL;
- goal + done criteria + constraints confirmation;
- mission timeline and current lease/agent;
- semantic decision cards;
- result/use/observation loop.

#### Workspace â€” PARTIAL

- Chat/Files/Changes/Preview/Settings currently exist;
- target: real tree, tabs, search, conflict, coherent artifact change set;
- code details remain available but are not primary owner decision language.

#### Asset Vault â€” TARGET

- apps, reports, designs, datasets, templates, skills, decisions;
- provenance, version, license, sensitivity, verification, reuse graph;
- open export and restore.

### Layer B â€” Mission Orchestration

#### Mission Execution Runtime â€” CODE READY / NOT PRODUCTION ACTIVATED

`BC-040` Ð½ÑŒ Mission v1-Ð¸Ð¹Ð³ authoritative objective/context root Ñ…ÑÐ²ÑÑÑ€ Ò¯Ð»Ð´ÑÑÐ½, versioned
Execution Plan, provider-neutral execution Task, hard/optional dependency DAG, capability-based
assignment, task lease/fencing token, immutable Attempt, append-only progress, evidence-backed
Result, Blocker, Retry, Cancellation Ð±Ð¾Ð»Ð¾Ð½ Closeout contract Ð½ÑÐ¼ÑÑÐ½.

Owner/full MCP registry Ð½ÑŒ 7 read, 10 controlled mutation, 3 owner-only operation schema-Ð³
advertise Ñ…Ð¸Ð¹Ð½Ñ. Durable execution store migration Ð¸Ð´ÑÐ²Ñ…Ð¶ÑÑÐ³Ò¯Ð¹ Ñ‚ÑƒÐ» mutation executor fail-closed.
ÐžÐ´Ð¾Ð¾Ð³Ð¸Ð¹Ð½ `subscription-readonly-v1` profile exact 12 read-only tool Ñ…ÑÐ²ÑÑÑ€; write-capable credential
Ð½ÑÑÑ…Ð³Ò¯Ð¹. Merge/deploy/rollback Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚ Ð±Ð¸Ñˆ Ð±Ó©Ð³Ó©Ó©Ð´ owner approval boundary Ó©Ó©Ñ€Ñ‡Ð»Ó©Ð³Ð´Ó©Ó©Ð³Ò¯Ð¹.

#### Mission Service â€” TARGET

Durable mission graph:

```text
Mission
 â”œâ”€ Tasks with dependency edges
 â”œâ”€ Operations with idempotency/approval
 â”œâ”€ Decisions
 â”œâ”€ Evidence
 â””â”€ Assets
```

Cloudflare Workflows ÑÑÐ²ÑÐ» equivalent durable workflow engine Ð½ÑŒ pause/resume, retry, wait-for-approval, timeout, cancellation, compensation Ð°ÑˆÐ¸Ð³Ð»Ð°Ð½Ð°. Durable Object Ð½ÑŒ coordination/lease; workflow history Ð½ÑŒ long-running progression-Ð´ Ð°ÑˆÐ¸Ð³Ð»Ð°Ð³Ð´Ð°Ð½Ð°.

#### Task Lease â€” TARGET

- owner/project/task scoped;
- one active writer;
- lease TTL + heartbeat;
- stale recovery;
- cross-agent handoff context hash;
- parallel read/review task Ð·Ó©Ð²ÑˆÓ©Ó©Ñ€Ð½Ó©.

### Layer C â€” Policy & Evidence Gate

#### AuthN/AuthZ â€” PARTIAL â†’ TARGET

Current shared Bearer auth Ð½ÑŒ foundation. Target:

- client/device/provider identity;
- short-lived scoped capability;
- project/mission namespace;
- revocation/rotation;
- rate/replay/idempotency;
- critical re-auth/owner confirmation.

#### Approval coordination â€” PARTIAL

- `pending_approval â†’ approved | rejected | expired | superseded` decision boundary;
- exact decision replay Ð½ÑŒ Ð¸Ð¶Ð¸Ð» idempotency key-ÑÑÑ€ state Ð´Ð°Ñ…Ð¸Ð½ Ó©Ó©Ñ€Ñ‡Ð»Ó©Ñ…Ð³Ò¯Ð¹;
- file/branch/deployment operation Ð½ÑŒ approved base/context SHA-Ñ‚Ð°Ð¹ pin Ñ…Ð¸Ð¹Ð³Ð´ÑÐ½Ñ;
- stale context external write/dispatch-Ð°Ð°Ñ Ó©Ð¼Ð½Ó© operation-Ð¸Ð¹Ð³ `superseded` Ð±Ð¾Ð»Ð³Ð¾Ð½Ð¾;
- PWA terminal status, TTL, context SHA Ñ…Ð°Ñ€ÑƒÑƒÐ»Ð¶ decision Ñ‚Ð¾Ð²Ñ‡Ð¸Ð¹Ð³ disable Ñ…Ð¸Ð¹Ð½Ñ;
- target gap: full semantic evidence card, capability identity, append-only decision audit,
  generic execution lease/compensation.

#### Risk engine â€” TARGET

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

#### Evidence Service â€” TARGET

Trusted producer-Ð¾Ð¾Ñ append-only evidence event Ð°Ð²Ñ‡:

- checksum/integrity;
- artifact reference;
- acceptance mapping;
- redaction;
- validity/supersession;
- release/rollback chain Ñ…Ð°Ð´Ð³Ð°Ð»Ð½Ð°.

Schema: `/docs/EVIDENCE_STANDARD.md`.

### Layer D â€” Second Brain & Asset Graph

#### Canonical Git memory â€” LIVE

- `BESTCODE_MASTER.md`;
- `docs/PROJECT_STATUS.md`;
- `docs/ARCHITECTURE.md`;
- `docs/ROADMAP.md`;
- `docs/DECISIONS/**`;
- policy/standard docs.

#### Dynamic project memory â€” PARTIAL

Durable Object-Ð´ task, handoff, approval Ð±Ð°Ð¹Ð½Ð°. Target-Ð´ Mission, Operation, Evidence metadata, Decision event Ð½ÑÐ¼ÑÐ³Ð´ÑÐ½Ñ.

#### Personal memory â€” TARGET

Git repository-Ð´ Ñ…Ð¸Ð¹Ñ…Ð³Ò¯Ð¹. Private owner-controlled store, explicit retention, sensitivity, export/delete, minimal Context Packet Ð°ÑˆÐ¸Ð³Ð»Ð°Ð½Ð°.

#### World evidence â€” TARGET

Source, Claim, contradiction, dossier, snapshot hash. Search index/vector Ð½ÑŒ derived Ð±Ó©Ð³Ó©Ó©Ð´ canonical source Ð±Ð¸Ñˆ.

#### Asset Graph â€” TARGET

Recommended entity relations:

```text
Goal â”€ownsâ†’ Mission â”€producesâ†’ Asset
Mission â”€usesâ†’ Source/Claim
Mission â”€containsâ†’ Task/Operation
AcceptanceCriterion â”€proved_byâ†’ Evidence
Asset â”€derived_fromâ†’ Asset/Source
Decision â”€governsâ†’ Mission/Project
Skill â”€reused_byâ†’ Mission
```

### Layer E â€” Execution planes

#### GitHub plane â€” LIVE/PARTIAL

- repository truth, branch, PR, CI;
- target release controller only approved `main` SHA-Ð³ production-Ð´ Ð½ÑÐ²Ñ‚Ñ€Ò¯Ò¯Ð»Ð½Ñ;
- non-main preview Ñ‚ÑƒÑÐ´Ð°Ð° hostname/environment;
- branch integration active traffic-Ð¸Ð¹Ð³ default-Ð°Ð°Ñ€ Ñ…Ð¾Ñ€Ð¸Ð³Ð»Ð¾Ð½Ð¾.

#### Local/PWA plane â€” PARTIAL

- IndexedDB workspace;
- local Preview, console capture;
- DeepSeek `/api/llm` loop;
- target diagnostics snapshot Ð±Ð¾Ð»Ð¾Ð½ repository-aware mission integration.

#### Runner plane â€” TARGET

- one ephemeral container/VM per task/workspace;
- source checkout by SHA;
- bounded install/build/test/process;
- egress, command, secret, resource policy;
- log/event streaming;
- destroy and artifact export.

Cloudflare Containers is a candidate, not canonical requirement. Adapter contract allows another secure runner.

#### Browser plane â€” TARGET

- public research acquisition;
- visual/e2e preview testing;
- owner-assisted authenticated session;
- screenshot/markdown/accessibility snapshot;
- domain/action/budget isolation.

Cloudflare Browser Run is a candidate implementation. CAPTCHA/access control bypass is forbidden.

#### AI provider plane â€” PARTIAL

- ChatGPT Actions/MCP/DeepSeek current integrations;
- target provider adapter reports capabilities, model/version, privacy class, cost/latency;
- role router chooses provider but policy remains outside provider;
- no provider memory is canonical.

## 5. Storage strategy â€” target

| Data | Preferred shape | Requirement |
|---|---|---|
| Canonical code/docs | GitHub | version history, PR, export |
| Task/lease/approval | Durable coordination store | consistency, TTL, namespace |
| Mission/claim/asset metadata | queryable relational store | schema, relation, export |
| Artifact/snapshot/log | object storage | checksum, retention, ACL |
| Search/vector index | derived index | rebuildable, not canonical |
| Secrets | provider secret store | never model/memory/artifact |

Specific vendor/storage decision Ð±Ò¯Ñ€ ADR Ð±Ð¾Ð»Ð¾Ð½ migration/export plan-Ñ‚Ð°Ð¹ Ð±Ð°Ð¹Ð½Ð°.

## 6. Context Packet

AI-Ð´ Ð±Ò¯Ñ… history Ó©Ð³Ó©Ñ…Ð³Ò¯Ð¹. Task-scoped packet:

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

Packet Ð½ÑŒ provider response Ð±Ò¯Ñ€Ñ‚ echo Ñ…Ð¸Ð¹Ñ… secret Ð°Ð³ÑƒÑƒÐ»Ð°Ñ…Ð³Ò¯Ð¹. Handoff Ð±Ð¾Ð»Ð¾Ð½ approval context hash-Ð°Ð°Ñ€ pin Ñ…Ð¸Ð¹Ð³Ð´ÑÐ½Ñ.

## 7. Operation flow

### Software change

```text
Intent contract
â†’ canonical context
â†’ agent branch
â†’ inspect/plan
â†’ staged coherent change
â†’ tests/preview/review
â†’ semantic approval
â†’ safe commit/push/PR
â†’ CI
â†’ merge main
â†’ release approval
â†’ deploy exact main SHA
â†’ smoke + active traffic assertion
â†’ observe + asset package
```

### Research mission

```text
Question/decision contract
â†’ search adapters
â†’ safe source acquisition
â†’ claims/provenance
â†’ cross-check/contradictions
â†’ safety/specialist gate
â†’ dossier approval
â†’ asset archive + freshness policy
```

### External transaction â€” future

```text
Research/plan
â†’ owner-visible exact transaction preview
â†’ re-check price/target/current session
â†’ just-in-time owner approval
â†’ execute once
â†’ receipt/evidence
â†’ no silent retry on ambiguous result
```

## 8. API design rules

- Tool name describes one bounded intent.
- Read and write capability Ñ‚ÑƒÑÐ´Ð°Ð°.
- Public arbitrary fetch/command endpoint Ð±Ð°Ð¹Ñ…Ð³Ò¯Ð¹.
- Input project/mission scope explicit; write-Ð´ default project Ð°ÑˆÐ¸Ð³Ð»Ð°Ñ…Ð³Ò¯Ð¹.
- Every mutation accepts idempotency key and expected version/hash.
- Response envelope: `ok`, `operation_id`, `status`, `result|error`, `evidence_refs`, `next_action`.
- Error Ð½ÑŒ retryable ÑÑÑÑ…, violated rule ID, owner action ÑˆÐ°Ð°Ñ€Ð´Ð»Ð°Ð³Ð°Ñ‚Ð°Ð¹ ÑÑÑÑ…Ð¸Ð¹Ð³ Ñ…ÑÐ»Ð½Ñ.
- Tool annotations hint Ð±Ð¸Ñˆ; server-side policy authoritative.
- OpenAPI/MCP/PWA executor Ð½ÑÐ³ business policy Ð°ÑˆÐ¸Ð³Ð»Ð°Ð½Ð°.

## 9. Observability

Mission timeline Ð½ÑŒ technical trace-Ð¸Ð¹Ð³ owner-level event Ð±Ð¾Ð»Ð³Ð¾Ð¶ Ñ…Ð°Ñ€ÑƒÑƒÐ»Ð½Ð°:

- task/role/provider start/stop;
- capability grant/deny;
- approval/waiver;
- source acquired/blocked;
- cost/latency/budget;
- test/review conclusion;
- release/traffic/rollback;
- error/retry/cancel.

Metrics Ð½ÑŒ privacy-safe, project-scoped Ð±Ð°Ð¹Ð½Ð°. Model chain-of-thought Ñ…Ð°Ð´Ð³Ð°Ð»Ð°Ñ…Ð³Ò¯Ð¹; action rationale Ð±Ð° evidence Ñ…Ð°Ð´Ð³Ð°Ð»Ð½Ð°.

## 10. Architecture invariants

1. GitHub `main` software truth Ñ…ÑÐ²ÑÑÑ€.
2. AI/provider canonical state ÑÐ·ÑÐ¼ÑˆÐ¸Ñ…Ð³Ò¯Ð¹.
3. Dynamic metadata system evidence-Ð¸Ð¹Ð³ Ð¾Ñ€Ð»Ð¾Ñ…Ð³Ò¯Ð¹.
4. Non-main production traffic Ð°Ð²Ð°Ñ…Ð³Ò¯Ð¹.
5. Secret untrusted plane Ñ€ÑƒÑƒ Ð¾Ñ‡Ð¸Ñ…Ð³Ò¯Ð¹.
6. One task/one writer lease.
7. Critical operation exact approval + evidence + rollback.
8. External content instruction Ð±Ð¸Ñˆ.
9. Personal, project, world data boundary Ñ‚ÑƒÑÐ´Ð°Ð°.
10. Canonical data open export-Ñ‚Ð°Ð¹.

