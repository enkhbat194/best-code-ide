# ADR 0003 — Subscription Agent MCP Gateway

- Status: Accepted for foundation implementation
- Date: 2026-07-24
- Scope: BestCode backend control plane

## Context

BestCode already exposes Custom GPT Actions and a remote MCP endpoint backed by the same repository, Project Brain, Mission, approval, CI, deployment, and rollback operations. The existing MCP endpoint also exposes mutation tools. ChatGPT/Codex and Claude subscription agents need a provider-neutral entry point that can read the same canonical project state without turning a model session into an authority or duplicating backend operations.

The current stable MCP protocol version on 2026-07-24 is `2025-11-25`. The announced `2026-07-28` specification is not yet the current stable contract and is not adopted by this foundation.

## Decision

### 1. BestCode remains the control plane

The agent model is not canonical state and does not own authorization. BestCode owns:

- project registry and project scope;
- Project Brain and Mission state;
- repository and CI evidence;
- approval policy;
- deployment and rollback controls;
- audit metadata.

A ChatGPT/Codex, Claude, or future MCP-capable session is an external actor using bounded tools.

### 2. Separate subscription and embedded-provider paths

- `Subscription Agent`: an externally hosted ChatGPT/Codex, Claude, or future MCP client that calls BestCode through remote MCP.
- `Embedded API Provider`: an optional API model called by BestCode itself. Paid providers remain default OFF.
- `Cloudflare Vision`: an owner-triggered utility and not a coding authority.

No new paid model key, OAuth provider, automatic routing, or autonomous deployment permission is introduced.

### 3. Use one shared tool service layer

`toolGateway.ts` is the common registry, dispatcher, safety classifier, timeout wrapper, redaction boundary, and audit-envelope builder.

- `/mcp` preserves the existing full MCP compatibility profile.
- `/api/actions/*` preserves Custom GPT Actions compatibility.
- `/mcp/subscription` uses a separate `subscription-readonly` profile.
- Existing tool executors remain the implementation source. Subscription aliases call those executors rather than copying repository, Brain, Mission, approval, or deployment logic.

### 4. Use stateless Streamable HTTP MCP

The gateway uses JSON-RPC 2.0 over Streamable HTTP and supports:

- `initialize`;
- capability negotiation;
- `ping`;
- `tools/list`;
- `tools/call`;
- protocol versions `2025-11-25`, `2025-06-18`, and `2025-03-26`.

The server is stateless and does not issue an `MCP-Session-Id`. GET and DELETE are rejected because this foundation does not expose server-sent event resumability or a stateful MCP session.

References:

- MCP specification: <https://modelcontextprotocol.io/specification/2025-11-25>
- MCP lifecycle: <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle>
- MCP transports: <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- MCP tools: <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>

### 5. Bind every subscription gateway to one project

The remote URL must include an allowed `project_id`, for example:

```text
/mcp/subscription?project_id=bestcode&agent_id=codex&agent_provider=openai
```

The Bearer token remains the authentication authority. `agent_id`, `agent_provider`, session metadata, prompt text, and tool arguments are audit identity only and cannot grant permission.

- `projects_list` returns only the bound project.
- All other subscription tools must pass the same `project_id`.
- Mission reads verify that the Mission belongs to the bound project.
- Cross-project calls fail closed before an upstream operation starts.

### 6. Foundation tool set is read-only

The subscription profile exposes:

- `projects_list`;
- `project_get`;
- `brain_search`;
- `brain_export_summary`;
- `mission_get`;
- `mission_context_get`;
- `repository_status`;
- `repository_read_file`;
- `repository_search`;
- `pull_request_status`;
- `deployment_status`;
- `handoff_packet_build`.

Repository mutation, branch creation, patching, commit, push, pull request creation, CI dispatch, deployment, rollback, approval decisions, and irreversible operations are not exposed by this profile.

### 7. Classify every tool

Every tool receives one BestCode safety class:

- `read-only`;
- `write-without-approval`;
- `approval-required`;
- `irreversible`.

MCP annotations remain available for client behavior, but BestCode safety classification and server-side checks are authoritative. A prompt is never accepted as approval.

### 8. Return structured, redacted envelopes

Every gateway result includes bounded metadata:

- request ID;
- actor and provider identity;
- project scope;
- safety class;
- idempotency metadata;
- audit outcome;
- existing operation ID, status, result, and safe error fields.

Keys and values resembling secrets, credentials, authorization headers, private keys, passwords, or tokens are redacted before tool output or logs.

### 9. Build deterministic handoff packets

`handoff_packet_build` returns `bestcode-handoff-packet-v1` with:

- project and Mission IDs;
- repository, base SHA, and branch;
- objective and completed work;
- changed files and test status;
- unresolved issues and required decisions;
- safety constraints;
- next exact action;
- source and evidence references;
- deterministic SHA-256 packet hash.

Provider names and provider-specific prose are excluded from the packet.

## OpenAI and Anthropic compatibility

OpenAI remote MCP clients can configure a remote server URL and authorization/header data, restrict allowed tools, and require approval based on tool policy. The BestCode subscription endpoint remains read-only even when a client requests broader behavior.

Reference: <https://platform.openai.com/docs/guides/tools-remote-mcp>

Anthropic remote MCP custom connectors require a reachable remote MCP server and support authorization flows depending on the client. BestCode retains its existing Bearer authentication and does not add OAuth registration in this change.

Reference: <https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp>

## Consequences

### Positive

- Subscription agents share one verified Project Brain, Mission, repository, and evidence plane.
- Existing PWA, Actions, Mission v1, Brain v2, R2, Attachment, and Vision behavior remains separate.
- No duplicated repository mutation implementation is added.
- Future write tools can be introduced behind explicit profiles and approval policy.

### Trade-offs

- The first subscription endpoint cannot edit code.
- A connector must be configured for one project scope.
- Bearer authentication remains owner-level and should be replaced by narrower delegated authorization only in a separate approved security project.
- Stateless MCP does not provide resumable SSE sessions.

## Explicitly deferred

- OAuth registration;
- public plugin submission;
- automatic Project or Mission routing;
- autonomous merge or deployment;
- paid API providers;
- browser-direct R2 access;
- automatic Cloudflare Vision processing;
- production mutation tools for subscription agents.
