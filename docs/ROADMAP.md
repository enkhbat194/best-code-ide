# BestCode Roadmap

Canonical plan: `/BESTCODE_MASTER.md` v1.0.0 (`LOCKED`)

Энэ файл нь Master-ийн phase дарааллыг дэлгэрүүлнэ. Зорилго, AI-ийн үүрэг, source-of-truth болон hard rule зөрвөл Master түрүүлж хүчинтэй.

## Phase 0 — Core controller — COMPLETED

- Cloudflare Worker ба mobile PWA
- ChatGPT Actions/OpenAPI ба Claude-compatible Remote MCP
- Project allowlist, repository read/search
- Approval-gated staged write, commit/push/PR
- GitHub Actions build/test/deployment tools

## Phase 1 — Repository stabilization — COMPLETED

- OpenAPI description regression protection
- Branch list/compare/delete tools
- SHA-pinned high-risk deletion approval
- Superseded PR/branch cleanup ба final verification

## Phase 2 — Project Brain v1 — CURRENT

- Locked Master, current Status, Architecture, Roadmap, decision history
- Canonical project context aggregation ба deterministic memory search
- Durable project task lifecycle ба cross-agent handoff
- ChatGPT Actions/MCP tool parity
- Provenance, project isolation, source-of-truth policy
- Unit/integration tests, CI, PR, merge, production verification

## Phase 3 — Production PWA update system

- Build/version metadata, update detection, release note
- Service worker activation, cache migration, stale-tab protection
- Offline recovery, rollback, iPhone standalone verification

## Phase 4 — Professional workspace v1

- Real file tree, multi-tab editor, breadcrumb, search
- Create/rename/move/delete, Git status, unsaved/conflict UI
- Coherent multi-file change set ба нэг ойлгомжтой approval
- Mobile ба desktop usability

## Phase 5 — Preview and diagnostics loop

- HTML/JS/TS/React/Python бодит smoke tests
- Preview console/runtime/network error capture
- Diagnostics snapshot-ийг DeepSeek, ChatGPT, Claude-д өгөх
- Bounded AI diagnosis/repair loop ба Preview sandbox security

## Phase 6 — Remote runner and terminal

- Ephemeral sandbox per workspace
- npm/pnpm/yarn install, approved shell command
- Process/port management ба streaming logs
- Timeout, resource, network, command, secret isolation

## Phase 7 — Security hardening

- Per-user/session auth, GitHub OAuth, MCP OAuth
- Rate limiting, replay protection, idempotency
- Durable audit timeline, approval expiry, secret redaction, strict CORS

## Phase 8 — Release verification

- ChatGPT Actions, Claude MCP, DeepSeek end-to-end smoke tests
- Full approval → PR → CI → merge → deploy → rollback flow
- iPhone Safari болон installed PWA verification
- Stable version tag, release notes, operational runbook
