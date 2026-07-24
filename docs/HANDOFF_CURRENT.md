# BestCode — Current Handoff

Current operational resume source:

- `docs/HANDOFF_NEXT_CHAT_V3.md`
- Chat 10 branch closeout: `agent/mission-execution-runtime-foundation` (`BC-040`)
- Chat 10 draft PR: `#82`
- Durable execution aggregate, owner/full MCP executor, authenticated REST facade, lease/fencing,
  approval gate, deterministic context/handoff, result/evidence болон audit contract code-ready.
- `subscription-readonly-v1` exact 12 tool хэвээр; production activation, merge, deploy хийгдээгүй.

Older handoffs are historical and must not be used as current project truth:

- `docs/HANDOFF_NEXT_CHAT.md`
- `docs/HANDOFF_NEXT_CHAT_V2.md`

New chat start command:

```text
GitHub repository `enkhbat194/best-code-ide` доторх `docs/HANDOFF_CURRENT.md`-г уншаад, түүнээс заасан current handoff болон canonical файлуудыг бүрэн унш. Дараа нь үргэлжлүүл.
```
# Chat 11 package A checkpoint (2026-07-24)

- Base: `main` at `554908b69fa855e2292a88357c67fc340e457370`.
- Branch: `agent/chat11-bounded-write-agent`.
- Added the separate `subscription-write-bounded-v1` credential contract.
- Default TTL is 30 minutes; maximum TTL is two hours.
- Credential scope binds project, Mission, execution plan, task, attempt, active lease identity, fencing token, agent, provider, branch, base SHA, tools, paths, limits, approval record, and idempotency namespace.
- Persistent storage contains only a SHA-256 secret verifier; raw credentials are one-time issue-response data and are absent from get/revoke responses.
- The deterministic scope hash detects binding changes.
- `subscription-readonly-v1` remains independent and exactly twelve tools.
- Targeted credential/read-only regression tests: 21 passed.
- Backend TypeScript typecheck: passed.
- Full backend suite: 184 passed; one pre-existing Windows-only test harness failure because local `bash` is unavailable (`typecheckPipeline.test.mjs`). Linux CI contract is unchanged.
- Next: Package B authentication, bounded tool advertisement, repository mutation enforcement, usage/idempotency accounting, and safety tests.

## Chat 11 package B checkpoint

- Credential authentication now selects `subscription-write-bounded` from the stored record; request parameters cannot select or widen it.
- MCP title is `BestCode Bounded Write`; tools/list is intersected with the credential allowlist.
- Merge, deploy, rollback, deletion, approval, credential administration, secrets, and arbitrary shell are absent.
- Project, exact branch, protected/allowed path, base SHA, branch-head SHA, and expected old-file hash checks fail before mutation.
- Every bounded mutation requires an `Idempotency-Key`.
- Durable authorization atomically reserves operation/file/byte/commit/push/PR usage before execution; replay does not execute the mutation again.
- Targeted Package B plus read-only, branch, and Mission lease regressions: 37 passed.
- Backend TypeScript typecheck: passed.
- Next: Package C owner write-task approval, live Mission/attempt/lease validation on issue and every mutation, owner API/OpenAPI, progress/result/audit integration, and automatic revoke on terminal execution state.

## Chat 11 Package C WIP shutdown checkpoint

- Branch/starting HEAD: `agent/chat11-bounded-write-agent` from Package B commit `520a442`.
- Added authoritative Mission Durable Object validation for project, Mission, active plan, running approval-required task, owner-approved gate, active attempt, active lease, fencing token, assigned agent, approval record, and exact task path scope.
- Owner credential issue now requires that complete live authority intersection.
- Every bounded mutation revalidates Mission authority before durable usage reservation and execution.
- Added owner-only issue/list/get/revoke, task status, and emergency task-revoke APIs.
- Added separate `/openapi-bounded-write.json` owner API contract so credential administration is not advertised by the agent MCP profile.
- Added bounded Mission progress/result/lease-release tool support; owner approval tools remain absent.
- Terminal result/block/cancel/release/rejection/Mission cancellation triggers best-effort credential cleanup; Mission state independently remains fail-closed.
- Added audit events for issue, denial, idempotent replay, emergency revoke, and terminal cleanup without raw credential data.
- Package C targeted tests cover active/stale task, attempt, lease, fencing, approval, cancellation, scope widening, one-time secret, emergency revoke, automatic terminal revoke, and OpenAPI separation.
- This is a WIP checkpoint, not Package C completion. Still required: finish full audit-event coverage review, add/verify bounded MCP progress/result integration tests, update canonical architecture/roadmap docs, run the complete backend/frontend regression suite, and continue Package D production smoke workflow.
