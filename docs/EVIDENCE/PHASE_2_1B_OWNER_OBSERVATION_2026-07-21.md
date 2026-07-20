# Phase 2.1B — Installed PWA owner observation

Date: 2026-07-21

Status: VERIFIED OWNER OBSERVATION; MAINTENANCE CLOSURE IMPLEMENTED

## Observed production state

The owner verified the installed iPhone PWA `Settings → Release & Integrity` screen after PR #21 deployment.

Observed values:

- integrity status: `Production source баталгаатай`;
- app source: `main · 15e23fb4`;
- GitHub main: `15e23fb4`;
- deploy policy: `BC-R23 · main only`;
- backend build: `master-v2-integrity-v1`;
- backend configuration: connected;
- observed check time: `2026-07-21 01:38:49` in the owner's device locale;
- Cloudflare PWA build time shown by the client: `2026-07-21 00:50:20`.

The installed application source and GitHub `main` matched exactly at observation time. The stale PWA cache incident was therefore recovered and the release-integrity owner observation required by Phase 2.1B passed.

## System Maintenance Center

This closure package adds an authenticated, SHA-pinned maintenance surface in Settings.

- stale pending/approved operations whose `base_context_sha` no longer matches current `main` can be terminalized as `superseded`;
- only unprotected `agent/*` branches proven `behind` or `identical` with zero commits ahead of `main` are eligible for deletion;
- both mutations require an exact confirmation literal and the exact planned `main` SHA;
- branch deletion additionally rechecks every branch SHA immediately before deletion;
- protected branches, `main`, `master`, changed branch SHAs, and stale plans fail closed.

The owner runs the two maintenance actions from the newly deployed PWA after merge. An empty maintenance plan is the final operational proof for Phase 2.1B completion.
