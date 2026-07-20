# BestCode Phase 3 — Creation OS execution package

Status: STARTED

This package turns the existing governed repository controller into a coordinated creation system. It does not replace the locked Master v2 safety rules. Production source lock, approval gates, exact SHA checks, evidence, and rollback remain mandatory.

## Execution order

### 3.0 Agent Runtime foundation

- durable agent/task identity;
- queue states: pending, ready, running, waiting, blocked, completed, failed, cancelled;
- priorities: critical, high, normal, low, background;
- dependency graph validation;
- deterministic ready-task planning;
- cycle, missing dependency, and failed dependency protection;
- later: lease, heartbeat, retry budget, provider adapter, concurrency cap.

### 3.1 Approval Center v2

- grouping by mission, branch, risk, and lifecycle;
- search, filter, and sorting;
- safe multi-select;
- bulk approve/reject only for compatible operations;
- stale/terminal items never enter an executable bulk request;
- semantic outcome, verification, impact, rollback, and evidence cards.

### 3.2 Release Manager

- immutable release history;
- source SHA → CI → deployment → runtime evidence timeline;
- current and previous-good release;
- canary plan and promotion gates;
- high-risk rollback request;
- post-release and post-rollback smoke evidence.

### 3.3 Branch Manager

- health states: healthy, ahead, behind, diverged, conflict, merged, stale, archived;
- archive metadata without pretending Git branches have a native archive state;
- safe restore by explicit new ref creation;
- auto-close policy for merged/superseded work;
- exact SHA revalidation before destructive cleanup.

### 3.4 Creation Graph and Project Brain integration

- mission → research → architecture → implementation → validation → release graph;
- task owner/agent/role and progress;
- file, approval, evidence, and release links;
- context packet for cross-agent continuation;
- no silent memory import from unrelated chats.

### 3.5 Multi-Agent Orchestrator

- provider-neutral agent registry;
- role assignment: architect, implementer, reviewer, tester, researcher;
- bounded parallel execution;
- dependency-aware queue;
- independent review for critical paths;
- one active writer lease per protected work scope;
- human approval remains required where policy requires it.

## First implementation slice

The first slice adds a pure deterministic scheduler in `backend/src/agentRuntime.ts` with regression tests. It intentionally performs no external mutation and does not yet dispatch providers. This creates a testable foundation before humans inevitably attach five models to one repository and ask why they all edited the same file.

## Exit gate for Agent Runtime foundation

- priority ordering is deterministic;
- completed dependencies release downstream tasks;
- incomplete dependencies wait;
- failed/cancelled/blocked dependencies block downstream tasks;
- duplicate IDs, missing dependencies, self-dependencies, and cycles fail closed;
- backend tests and TypeScript typecheck pass;
- no existing approval, task, deployment, or branch behavior regresses.
