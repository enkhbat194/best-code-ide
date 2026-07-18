# Branch cleanup audit

Date: 2026-07-18

Repository: `enkhbat194/best-code-ide`

Default branch: `main`

Audited main SHA: `52ae0162cf0d50c55bc74c0c37cbf14d5d16af00`

## Decision rules

- Never delete `main`, `master`, the configured default branch, or a GitHub-protected branch.
- A merged pull-request head may be removed because the reviewed history remains attached to the pull request and `main`.
- A closed, unmerged head may be removed only after its replacement or obsolescence is documented.
- Every deletion must use the BestCode high-risk approval flow pinned to the branch's current SHA.
- If a branch SHA changes after approval, the deletion must fail and require a new approval.

## Branch classification

| Branch | Evidence | Classification |
|---|---|---|
| `agent/ide-core-v1` | PR #2 merged | Delete after approval |
| `agent/agent-loop-v1` | PR #3 merged | Delete after approval |
| `agent/mcp-readonly-v1` | PR #4 merged; branch is fully behind `main` | Delete after approval |
| `agent/mcp-safe-write-v1` | PR #5 merged; branch is fully behind `main` | Delete after approval |
| `agent/git-delivery-build-v1` | PR #6 merged; branch is fully behind `main` | Delete after approval |
| `agent/deploy-tools-v1` | PR #7 closed with an explicit "Superseded by PR #9" record | Delete after approval |
| `agent/openapi-actions-v1` | PR #8 merged; branch is fully behind `main` | Delete after approval |
| `agent/deploy-actions-v2` | PR #9 merged; branch is fully behind `main` | Delete after approval |
| `agent/openapi-description-limit` | PR #10 squash-merged as `52ae0162` | Delete after approval |
| `cloudflare/workers-autoconfig` | PR #1 closed as obsolete; its root config conflicts with the current split backend/frontend Wrangler setup | Delete after approval |
| `agent/repository-cleanup-v1` | Carries this audit and the PWA approval UI required to execute cleanup safely | Delete after its PR is merged and deployed |

## Pull requests

- PR #1 was closed as superseded. Its root `wrangler.jsonc` used the backend Worker name with the frontend source directory and is not the production source of truth.
- PR #7 was already closed and explicitly superseded by merged PR #9.
- PRs #2-#6 and #8-#10 are merged.
- No remaining open pull requests are expected after this cleanup.

## Pending execution

The ten pre-existing non-default branches above are approved cleanup candidates, but this audit does not itself delete them. The PWA `Changes` view stages one high-risk approval per branch and executes the deletion only after the user presses **Approve**. The cleanup implementation branch must be removed through the same flow after its PR is merged and deployed. Final verification must record the resulting branch list, `main` SHA, and CI status.
