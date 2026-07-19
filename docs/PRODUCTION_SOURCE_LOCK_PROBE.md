---
document: BestCode Production Source Lock Probe
status: DO-NOT-MERGE
created_at: 2026-07-19
---

# Deliberate non-main isolation probe

This branch exists only to prove that Cloudflare builds a non-main commit with
`wrangler versions upload` while both production Workers remain pinned to the
current `main` SHA at 100% traffic.

Expected evidence is produced by `.github/workflows/release-integrity.yml`.
