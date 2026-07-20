# Phase 2.1B — Installed PWA owner observation

Date: 2026-07-21

Status: VERIFIED OWNER OBSERVATION

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

## Remaining operational closure gates

This observation does not by itself prove that old Durable Object approval operations were rewritten or that every merged branch reference was deleted. Phase 2.1B may be marked complete only after:

1. operations pinned to obsolete context SHA `e86e22e...` are terminalized as `superseded` or otherwise proven non-executable;
2. merged/superseded branch refs are deleted through the SHA-pinned branch-cleanup path;
3. final repository status records the above evidence without claiming unobserved mutations.

No production rollback or additional deployment is required for this evidence record.
