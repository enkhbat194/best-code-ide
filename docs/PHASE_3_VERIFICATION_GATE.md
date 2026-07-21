# Phase 3 — Mobile Trust UX & Release Control Verification Gate

Status: `IN PROGRESS — IMPLEMENTATION MERGED, OWNER RUNTIME EVIDENCE PENDING`

Canonical roadmap: `docs/ROADMAP.md`

## 1. Purpose

Phase 3 is not complete merely because the code merged. The exit gate requires owner-visible runtime evidence from the installed PWA and an exact explanation of the active source, update state, approval risk, release history, and rollback boundary.

## 2. Implemented packages

### 3A — Version/update contract

- frontend/backend API schema compatibility;
- installed-PWA source SHA and GitHub `main` comparison;
- update lifecycle: `current`, `available`, `ready`, `applying`, `failed`, `offline`;
- stale-tab and schema mismatch detection;
- one-time reload-loop guard;
- service-worker update activation request;
- offline recovery copy and regression tests.

Historical delivery:

- PR `#33`;
- merge SHA `23ea7bbb5213777d47066b5af2de70087094c4d6`;
- owner screenshot verified the installed PWA and GitHub `main` at `23ea7bbb` with a compatible update contract.

### 3B — Semantic approval and release history

- owner-readable approval classification;
- risk, status, branch and timestamp visibility;
- deployment task/history card;
- production deployment, critical-path, branch cleanup and file-change distinctions.

Historical delivery:

- PR `#34`;
- merge SHA `7cc23bd126c17c3d58b88ddcfe4aed57fa6227ec`.

### 3C — Exact rollback request contract

- `rollback_request` Actions/MCP tool;
- exact Worker, Cloudflare version ID and 40-character target commit SHA;
- incident note and smoke expectation;
- current-main SHA pinning;
- current-main target rejection;
- 30-minute high-risk approval;
- Settings rollback request card;
- semantic approval history integration.

Historical delivery:

- PR `#35`;
- merge SHA `7f30e4ba246b71588337653e0af8871b9d0feec5`;
- Test run `29819283674` passed;
- Validate run `29819283679` passed.

## 3. Runtime verification matrix

The owner must verify the following from the installed iOS PWA.

| Check | Required evidence | Status |
|---|---|---|
| Current source | App source branch/SHA equals GitHub `main` | Pending current screenshot |
| Schema compatibility | App/backend schema reported compatible | Pending current screenshot |
| Update lifecycle | Current or updated state visible without reload loop | Pending current screenshot |
| Approval semantics | At least one approval card shows purpose, risk and status clearly | Pending screenshot |
| Release history | Deployment history card loads or explicitly reports no history | Pending screenshot |
| Rollback request UI | Exact Worker/version/SHA/incident/smoke fields visible | Pending screenshot |
| Safety boundary | UI states request/approval does not itself switch traffic | Pending screenshot |
| Offline recovery | Offline state renders a recovery message without destructive cache loop | Pending controlled observation |
| Stale-tab handling | SHA/schema mismatch becomes update-required rather than silently continuing | Covered by regression tests; optional owner simulation |

## 4. Rollback safety boundary

`rollback_request` creates a high-risk approval record only. It does not:

- dispatch GitHub Actions;
- change Cloudflare traffic;
- activate a previous Worker version;
- restore production automatically.

Actual rollback/rehearsal remains a separate irreversible production action using the existing exact-version rollback controller, smoke test, and restore guard.

## 5. Exit decision

Phase 3 may be marked `COMPLETED` only after:

1. current production PWA source equals the current GitHub `main`;
2. Settings shows the update contract as compatible/current;
3. semantic approval and release-history cards render without raw backend errors;
4. rollback request UI renders its exact-target fields and safety copy;
5. owner runtime screenshots/observations are recorded;
6. no production rollback is executed merely to close the UI phase.

Until those observations are recorded, Phase 4 implementation must not be represented as the active completed gate.