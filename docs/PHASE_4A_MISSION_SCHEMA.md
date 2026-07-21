# Phase 4A — Mission schema/API foundation

Status: `COMPLETED — IMPLEMENTATION AND OWNER RUNTIME VERIFICATION PASSED`

## Scope

Phase 4A нь stale PR #23-ийг merge хийхгүйгээр current `main` дээр Mission coordination foundation-ийг цэвэр дахин байгуулсан.

## Delivered packages

### 4A.1 — Schema foundation

- `MissionRecord` aggregate;
- Goal, AcceptanceCriterion, Decision, Task, Operation identifiers;
- canonical lifecycle states;
- bounded lifecycle transition guard;
- dependency graph validation;
- deterministic context hash/version contract;
- one-active-writer lease guard;
- schema regression tests.

### 4A.2 — Durable store and API

- durable Mission create/read/list;
- lifecycle transition;
- optimistic `context_version` concurrency;
- writer lease acquire/heartbeat/release;
- context hash and graph validation on read/write;
- authenticated routing and audit emission;
- durable CRUD/concurrency/lease tests.

### 4A.3 — MCP parity and Context Packet

- `mission_create`;
- `mission_get`;
- `mission_list`;
- `mission_transition`;
- `mission_lease`;
- `mission_context_packet`;
- MCP routing, annotations and description-bound tests;
- provider-neutral Context Packet containing lifecycle, context version/hash, goals, criteria, open decisions, active tasks, evidence IDs and writer lease.

### 4A.4 — Mutation and Actions parity

- `mission_mutate`;
- Goal, criterion, Decision, Task and Operation mutation;
- active writer lease requirement;
- stale `context_version` rejection;
- idempotency key and exact replay;
- MCP and ChatGPT Actions/OpenAPI name/schema parity;
- bounded OpenAPI descriptions and regression tests.

## Clean-transplant decision

Superseded PR #23-оос зөвхөн fail-closed dependency graph concept-ийг хадгалсан. Хуучин `agentRuntime` API/store болон `bestcode-agent-runtime` synthetic project ID-г шууд шилжүүлээгүй. Учир нь тэд current security, approval, audit, release, Mission, lease, context-version болон idempotency contract-оос өмнөх хувилбар байсан.

## Verification gate

Installed iOS PWA-ийн owner-visible production smoke test дараах бүх шалгалтыг амжилттай давсан:

- `mission_create` — canary Mission үүссэн;
- `mission_get` — lifecycle, context version/hash зөв уншигдсан;
- writer lease — нэг writer lease авсан;
- concurrency — хоёр дахь writer блоклогдсон;
- `mission_mutate` — Goal хадгалагдсан;
- stale context — хуучин version бүхий mutation блоклогдсон;
- `mission_context_packet` — `mission-context-packet-v1` зөв үүссэн;
- lease cleanup — writer lease суллагдсан.

Owner observation:

- observed at: `2026-07-21 19:13:40`;
- final context version: `v3`;
- final context hash: `fnv1a32:1bd17c01`;
- UI result: `Phase 4A functional smoke амжилттай`.

CI evidence for the smoke-panel package:

- PR `#42`;
- Test run `29825009459`: success;
- Validate run `29825009599`: success;
- merge SHA `37cc629de27357d7363164fcb89e89817b8c6cb1`.

## Safety boundary

Phase 4A Mission operations нь coordination metadata өөрчилнө. Тэдгээр нь өөрсдөө:

- repository code бичихгүй;
- provider dispatch хийхгүй;
- CI/deployment эхлүүлэхгүй;
- rollback хийхгүй;
- production traffic өөрчлөхгүй;
- existing approval болон protected-branch policy-г алгасахгүй.

## Closeout decision

Phase 4A implementation, CI, production source delivery болон owner functional smoke evidence бүрэн болсон. Phase 4A нь `COMPLETED`.

Дараагийн canonical package: **Phase 4B — Mission Canvas**.
