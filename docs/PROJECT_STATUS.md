Master v2 rule: `BC-R23` — non-main branch production traffic хэзээ ч авахгүй.

Current delivery package: Phase 2.1B — approval terminal-state, stale decision,
idempotency/replay хамгаалалт. Production owner observation passed at exact
`main · 15e23fb4`. System Maintenance Center implementation is staged in PR #22;
final operational closure requires running its SHA-pinned stale-approval and merged-branch
cleanup actions after deployment.

## 5. Current live capability vs target

| Area | Current | Target gap |
|---|---|---|
| Auth | Shared Bearer token | client identity, capability, revoke, rate/replay |
| Project Brain | Git docs + task/handoff | Mission, Owner/World memory, Asset Graph |
| PWA Chat | local `/api/llm` DeepSeek loop | repository-aware Mission Orchestrator |
| Files | IndexedDB/GitHub import | professional tree/tabs/search/conflict |
| Preview | local preview + UI console capture | diagnostics evidence + AI repair loop |
| Approval | terminal state, TTL/context SHA, decision idempotency, stale invalidation | full semantic outcome/evidence/rollback card |
| Git delivery | branch/commit/push/PR + production source lock + tested previous-good rollback v1 | owner-visible release history, incident UX, one-tap approved rollback |
| Maintenance | authenticated SHA-pinned stale approval and merged branch cleanup staged | archive policy, scheduled GC, storage analytics |
| Research | none | safe search/source/claim/dossier pipeline |
| Runner | GitHub workflow dispatch only | isolated ephemeral terminal/build plane |
| Evidence | scattered GitHub/CI metadata | canonical append-only evidence records |
| Personal assets | repository/project files | exportable Asset Vault and reuse graph |

## 6. Known open defects/gaps

### P0

- Phase 2.1B maintenance implementation must be merged/deployed and its two cleanup actions executed once.
- Shared token-д rate/replay/per-client capability байхгүй.
- Critical workflow/path class болон independent review хэрэгжээгүй.

### P1

- Installed PWA-д build/source card ба stale reload нэмэгдсэн; update-available banner, history, rollback UI байхгүй.
- Preview diagnostics external AI/DeepSeek-д structured tool-оор очихгүй.
- Evidence record/redaction/acceptance mapping байхгүй.
- Task lease/heartbeat/idempotency бүрэн биш.
- Personal memory/Asset Graph байхгүй.

### Not implemented yet

- Web Research Agent;
- Browser Run integration;
- remote runner/container;
- semantic approval;
- cross-provider reviewer/router;
- real-world Engineering/Sourcing modes.

Эдгээрийг Master-д TARGET гэж тэмдэглэсэн; production capability гэж тайлагнахгүй.

## 7. Next execution order

1. PR #22 merge/deploy → System Maintenance Center-ээр stale approval болон merged branch cleanup ажиллуулах → Phase 2.1B COMPLETED.
2. Phase 2.1C/D — auth/rate/redaction/critical path conformance.
3. Phase 3 — mobile version/update/semantic approval/rollback.
4. Phase 4 — Mission Control/Second Brain/Asset Graph.
5. Phase 5 — Web Research Agent v1.

## 8. Operational rule

Owner-оор GitHub/Cloudflare-ийн давтагдсан алхам хийлгэхгүй. Зөвхөн external account login, secret/billing setup, irreversible high-risk decision, safety-critical sign-off үед owner action авна.
