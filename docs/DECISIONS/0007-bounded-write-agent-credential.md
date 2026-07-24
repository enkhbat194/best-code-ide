---
document: ADR 0007
title: Bounded write agent credential
status: ACCEPTED
date: 2026-07-24
owner: Enkhbat
---

# Context

`subscription-readonly-v1` intentionally exposes exactly twelve read-only tools. A remote AI agent now needs narrowly bounded repository mutation for one owner-approved Mission task without receiving owner, merge, deployment, rollback, secret, or arbitrary-shell authority.

# Decision

Add a separate provider-neutral profile named `subscription-write-bounded-v1`. It does not replace or upgrade `subscription-readonly-v1`.

The authoritative credential record binds all of the following:

- project, Mission, execution plan, task, attempt, active lease, and fencing token;
- agent and provider identity;
- one exact working branch and approved base SHA;
- allowed tools, allowed paths, default protected paths, and safety class;
- operation, file, byte, commit, push, and draft-PR limits;
- idempotency namespace and owner approval record;
- a deterministic SHA-256 scope hash.

The default lifetime is 30 minutes and the hard maximum is two hours. The raw `bcwrite_v1` bearer is returned only in the owner-only issue response. Persistent storage contains only its SHA-256 verifier. Status and revoke responses never contain the raw bearer.

The stored profile is authoritative. A request parameter cannot turn a read-only credential into a write credential. Any mismatch in a bound field fails closed.

# Consequences

- Read-only connector compatibility and its exact twelve-tool registry remain locked.
- Write authority is short-lived and cannot be self-created, renewed, widened, transferred, or used outside one approved execution attempt.
- Merge, production deploy, rollback, credential administration, approval, secret management, and arbitrary shell remain unavailable.
- Runtime authentication, Mission-state validation, mutation accounting, tool advertisement, and production smoke are implemented as subsequent Chat 11 packages on this contract.

