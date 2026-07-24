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
