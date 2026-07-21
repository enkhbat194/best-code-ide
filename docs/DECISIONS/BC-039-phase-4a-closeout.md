---
decision_id: BC-039
title: Phase 4A Mission schema/API closeout
status: accepted
accepted_at: 2026-07-21
owner: Enkhbat
risk: core
---

# BC-039 — Phase 4A Mission schema/API closeout

## Шийдвэр

Phase 4A — Mission schema/API нь implementation, CI, production Actions delivery болон installed-PWA owner functional smoke evidence бүрэн болсон тул `COMPLETED` болно.

## Баталгаажсан capability

- durable Mission create/read/list;
- bounded lifecycle transition;
- deterministic context version/hash;
- one-active-writer lease acquire/heartbeat/release;
- second-writer concurrency block;
- optimistic stale-context rejection;
- Goal, AcceptanceCriterion, Decision, Task, Operation mutation;
- idempotent mutation replay;
- provider-neutral Mission Context Packet;
- MCP болон ChatGPT Actions/OpenAPI parity;
- owner-visible production smoke and lease cleanup.

## Owner runtime evidence

2026-07-21-ний installed iOS PWA smoke result:

- `mission_create`: passed;
- `mission_get`: passed;
- writer lease/concurrency: passed;
- `mission_mutate`: passed;
- stale context block: passed;
- `mission_context_packet`: passed;
- lease cleanup: passed;
- final context: `v3`;
- final hash: `fnv1a32:1bd17c01`;
- overall: `Phase 4A functional smoke амжилттай`.

## Delivery evidence

- PR #38 — schema foundation;
- PR #39 — durable store/API;
- PR #40 — MCP parity;
- PR #41 — mutation and Actions parity;
- PR #42 — owner-visible production smoke panel;
- PR #42 Test `29825009459`: success;
- PR #42 Validate `29825009599`: success;
- production smoke panel merge SHA `37cc629de27357d7363164fcb89e89817b8c6cb1`.

## Safety boundary

Mission coordination state нь repository write, provider dispatch, deployment, rollback эсвэл production traffic switch хийх эрх биш. Existing approval, protected-branch, CI болон release policy хэвээр хүчинтэй.

## Үр дагавар

Phase 4A дахин нээлттэй implementation gate биш. Дараагийн canonical ажил нь **Phase 4B — Mission Canvas**:

- owner intent capture;
- AI understanding confirmation;
- done criteria editor;
- progress/agent/lease timeline;
- owner decision inbox;
- next most valuable action.

Phase 4A-д илэрсэн defect нь тусдаа regression/incident байдлаар засагдана; шинэ UI scope-ийг Phase 4A нэрээр нууцаар нэмэхгүй.
