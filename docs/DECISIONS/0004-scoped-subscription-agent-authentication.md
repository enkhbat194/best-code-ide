# ADR 0004 — Scoped Subscription Agent Authentication

- Status: Accepted for implementation
- Date: 2026-07-24
- Scope: BestCode backend authentication and subscription MCP boundary

## Context

`/mcp/subscription` already exposes a locked read-only tool profile, but requests currently pass through the same owner `AUTH_TOKEN` gate as owner APIs and `/mcp`. Agent identity is also supplied by request headers. Giving that master credential to ChatGPT, Codex, Claude, or another remote MCP client would collapse authentication, project scope, authorization, profile selection, and owner approval into one credential.

The current MCP authorization contract requires Bearer credentials in the `Authorization` header, rejects tokens in URI query strings, requires invalid or expired credentials to fail with HTTP 401, and recommends short-lived credentials. Full standards-based MCP OAuth remains a separate future delegated-auth project because it requires protected-resource metadata, authorization-server discovery, resource indicators, PKCE, and lifecycle infrastructure.

References:

- <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- <https://platform.openai.com/docs/guides/tools-remote-mcp>
- <https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector>

## Decision

### 1. Separate credential classes

BestCode recognizes four distinct classes:

1. owner credential — existing `AUTH_TOKEN`, owner authority, legacy compatibility;
2. subscription-agent scoped credential — project-bound, read-only, expiring, revocable;
3. internal production workflow credential — existing protected workflow secret usage;
4. future OAuth/delegated credential — deferred and never inferred from the scoped-token foundation.

A scoped token is never retried or reinterpreted as an owner token. Authentication, authorization, MCP profile selection, tool authorization, and owner approval remain separate checks.

### 2. Reuse existing durable storage

Scoped credential records are stored in the existing `SECURITY_AUDIT` Durable Object. No new database, paid resource, secret, permission, or Cloudflare binding is introduced.

The persisted record contains credential ID, project ID, authoritative agent/provider identity, locked MCP profile and tool-set version, issue/expiry/revoke timestamps, creator identity, usage metadata, version, note, audit metadata, and a SHA-256 secret hash. Plaintext credentials are never persisted, logged, returned by list/get, or written to evidence artifacts.

### 3. Token contract

The opaque Bearer token has versioned syntax:

```text
bcsub_v1.<credential-id>.<random-secret>
```

The raw token is returned exactly once by owner-only creation. Minimum lifetime is 5 minutes, default lifetime is 24 hours, and maximum lifetime is 30 days. Renewal means creating a new credential and revoking the old one; old plaintext cannot be recovered.

Scoped credentials are accepted only in the `Authorization: Bearer ...` header. Query-string scoped credentials are rejected. Existing owner query-key compatibility is retained only for legacy owner workflows.

### 4. Authoritative scope and identity

A valid scoped credential is locked to:

- `/mcp/subscription`;
- one `project_id`;
- `subscription-readonly`;
- `subscription-readonly-v1` exact tool set.

Agent ID and provider come from the credential record. Request headers, URL parameters, model names, prompt text, and tool arguments cannot replace them or widen scope.

### 5. Fail-closed precedence

Requests are evaluated in this order:

1. identify credential class;
2. hash and constant-time comparison;
3. expiry, revoked, and disabled state;
4. endpoint restriction;
5. project restriction;
6. profile restriction;
7. server-side tool authorization;
8. redacted audit emission.

Unknown, malformed, expired, revoked, disabled, wrong-project, and wrong-endpoint scoped tokens return the same generic authentication failure. Mutation tools remain unavailable even when called directly.

### 6. Owner-only lifecycle API

The service contract defines:

- `subscription_credential_create`;
- `subscription_credential_list`;
- `subscription_credential_get`;
- `subscription_credential_revoke`.

The initial surface is owner-only REST under `/api/subscription/credentials`. These operations are not advertised in the subscription MCP profile and are intentionally not added to Custom GPT Actions or owner MCP in this change because create returns a one-time secret and revoke is security-sensitive.

### 7. Audit contract

Every scoped MCP tool call records credential ID, project ID, agent ID, provider, MCP profile, tool name, request ID, outcome, denial code when present, credential version, and tool-set version. Authorization headers, raw tokens, secret hashes, and sensitive environment values are redacted or excluded.

## Consequences

### Positive

- Subscription agents no longer require the owner master credential.
- One leaked scoped credential is limited by project, endpoint, read-only profile, and expiry.
- Revoke takes effect on the next authentication request.
- Existing owner APIs, PWA, Actions, `/mcp`, Mission, Brain, repository operations, Attachment/Vision, and production workflows keep the owner path.

### Trade-offs

- This opaque scoped Bearer credential is not a complete MCP OAuth 2.1 implementation.
- The existing audit Durable Object now stores two namespaced record families.
- A remote connector still needs the one-time credential configured securely by the owner.

## Explicitly deferred

- OAuth authorization server and protected-resource metadata;
- refresh tokens and delegated consent UI;
- subscription write profiles;
- automatic credential rotation;
- public connector/plugin publication;
- production credential issuance without explicit owner approval.
