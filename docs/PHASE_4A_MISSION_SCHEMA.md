# Phase 4A — Mission schema/API foundation

Status: `IN PROGRESS — SCHEMA FOUNDATION`

## Scope of this package

This package starts Phase 4A from the current `main`. It does not merge the stale PR #23 branch.

Implemented foundation:

- `MissionRecord` aggregate;
- Goal, AcceptanceCriterion, Decision, Task and Operation identifiers;
- canonical lifecycle states;
- bounded lifecycle transition guard;
- dependency graph validation;
- deterministic context hash/version contract;
- one-active-writer lease availability guard;
- regression tests for transition, graph, hash and lease behavior.

## Clean-transplant decision

From superseded PR #23, only the fail-closed dependency graph concept was retained. The old `agentRuntime` API/store and its synthetic `bestcode-agent-runtime` project ID were not transplanted because they predate the current:

- Phase 2.1 security and critical-path contracts;
- Phase 3 release/update contract;
- Mission/Goal/AcceptanceCriterion/Decision/Operation model;
- writer lease, context version and idempotency requirements.

## Deliberately excluded from this first package

- public Mission REST/Actions/MCP endpoints;
- durable Mission store migration;
- lease acquire/heartbeat/release mutation;
- pause/resume/cancel/recover commands;
- Mission Canvas UI;
- provider dispatch;
- automatic execution.

These are follow-up Phase 4A packages after the schema gate is green.

## Exit evidence

- backend unit tests pass;
- TypeScript validation passes;
- Critical Path Conformance passes when required;
- PR is based on the current `main`;
- no production mutation occurs from this package.