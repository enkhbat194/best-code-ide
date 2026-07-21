# Phase 2.1C — Request and Redaction Foundation

## Scope

This bounded package starts the canonical Phase 2.1C security floor without changing authentication semantics or provider integrations.

Delivered:

- Worker-edge request body size guard;
- configurable `MAX_REQUEST_BYTES` with a safe 1 MiB default;
- invalid `Content-Length` rejection;
- shared text and structured-value secret redaction helpers;
- regression tests for body limits and common bearer, query, provider, and keyed secrets.

## Deliberately excluded

- distributed per-client rate limiting;
- token rotation automation;
- strict CORS allowlist migration;
- audit export persistence;
- retrofitting every existing log/evidence call in one change.

Those remain separate Phase 2.1C packages so this security change stays reviewable and rollback-safe.

## Safety contract

- ChatGPT Actions, Claude MCP, BestCode PWA, and existing authenticated routes keep their current authorization flow.
- GET, HEAD, and OPTIONS requests are not body-limited.
- Mutation requests with no `Content-Length` continue to work; streaming byte enforcement remains a later bounded executor concern.
- Redaction output is derived safety data and never becomes canonical evidence.
