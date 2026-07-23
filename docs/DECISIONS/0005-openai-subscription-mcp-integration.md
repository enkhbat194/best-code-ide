# ADR 0005 — OpenAI Subscription MCP Integration

- Status: Accepted for implementation
- Date: 2026-07-24
- Scope: OpenAI subscription clients connected to the BestCode production subscription MCP boundary

## Context

BestCode is a project control plane, not an AI model. ADR 0003 established a provider-neutral read-only subscription MCP profile, and ADR 0004 separated owner authentication from project-scoped, expiring, revocable subscription credentials.

OpenAI currently has three materially different MCP integration surfaces:

1. Codex CLI, Codex IDE extension, and the ChatGPT desktop app use a Codex host, support Streamable HTTP MCP servers, support Bearer tokens sourced from an environment variable, and share MCP configuration.
2. ChatGPT web uses plugin-provided remote MCP tools. An authenticated ChatGPT app is expected to implement MCP OAuth 2.1; the developer-mode registration UI does not define an arbitrary static Bearer-header field.
3. The OpenAI Responses API can call remote MCP servers with `server_url`, `allowed_tools`, authorization or headers, and approval policy, but requires a paid OpenAI API key.

References:

- <https://developers.openai.com/codex/mcp>
- <https://developers.openai.com/apps-sdk/build/auth>
- <https://developers.openai.com/apps-sdk/deploy/connect-chatgpt>
- <https://platform.openai.com/docs/guides/tools-remote-mcp>

## Decision

### 1. Selected OpenAI surface

The supported initial integration is the local Codex-host configuration shared by:

- Codex CLI;
- Codex IDE extension;
- ChatGPT desktop app.

The primary owner setup and production smoke identity is `provider=openai`. No OpenAI API key is added.

ChatGPT web developer-mode app registration remains unsupported for this opaque scoped-Bearer design until BestCode deliberately adds standards-compliant OAuth 2.1 or OpenAI exposes another official authenticated registration contract. The scoped token must not be moved into the URL query string as a workaround.

### 2. Server and authorization contract

The production Streamable HTTP MCP URL is:

```text
https://best-code-ide.enkhbat194.workers.dev/mcp/subscription?project_id=bestcode
```

Authorization is:

```text
Authorization: Bearer <one-time-issued scoped credential>
```

Codex configuration references the environment variable `BESTCODE_OPENAI_SUBSCRIPTION_TOKEN` through `bearer_token_env_var`. The raw credential is never written to Git, repository documentation, test fixtures, logs, immutable evidence, or generated configuration.

The owner master token is used only against owner lifecycle and audit endpoints. It is never configured in ChatGPT, Codex, an MCP URL, or an MCP request made by the subscription agent.

### 3. Connector configuration contract

`backend/src/openaiSubscriptionConnector.ts` is the executable configuration contract. It locks:

- schema version `bestcode-openai-subscription-connector-v1`;
- provider `openai`;
- supported surface;
- exact HTTPS `/mcp/subscription` URL;
- one authoritative `project_id` query parameter;
- agent name and provider;
- Bearer-from-environment authorization;
- exact `subscription-readonly-v1` tool set;
- approval mode `writes`;
- credential expiry of no more than 30 days;
- create-new-then-revoke-old rotation;
- initialize, tools/list, `project_get`, and audit connection checks;
- owner-only revoke path.

The contract rejects ChatGPT web, API-based, or unknown surfaces; extra URL parameters; query credentials; wrong provider; added or reordered tools; expired or overlong credentials; and raw scoped-token material.

### 4. Exact allowed tools

Only these twelve tools may be discovered:

1. `projects_list`
2. `project_get`
3. `brain_search`
4. `brain_export_summary`
5. `mission_get`
6. `mission_context_get`
7. `repository_status`
8. `repository_read_file`
9. `repository_search`
10. `pull_request_status`
11. `deployment_status`
12. `handoff_packet_build`

They reuse the existing shared gateway and service layer. No OpenAI-specific duplicate tool implementation is created. Every tool remains annotated read-only, non-destructive, idempotent, and unable to treat prompt text or tool arguments as permission.

### 5. Identity and audit

The credential record is authoritative for:

- credential ID;
- project ID;
- agent ID;
- provider `openai`;
- MCP profile;
- credential version;
- tool-set version;
- issue and expiry timestamps.

Request headers, URL metadata, client names, model names, and prompts cannot override those fields. Each tool call persists an `mcp_tool_call` audit event containing the authoritative connector metadata and no raw credential.

### 6. Approval behavior

Codex `default_tools_approval_mode = "writes"` is selected. OpenAI may automatically use correctly annotated read-only tools while any future non-read-only discovery would require approval at the client boundary. This is defense in depth only: the exact client allowlist and BestCode subscription profile both deny mutation tools server-side.

The subscription agent receives no BestCode approval, merge, deploy, rollback, credential-management, or owner authority.

### 7. Lifecycle and reconnect workflow

1. Owner creates a short-lived `provider=openai` credential.
2. Owner stores the one-time secret only in the local environment variable.
3. Codex host reconnects using the unchanged server URL and environment-variable reference.
4. Owner verifies initialize, exact tools/list, `project_get`, and the persisted audit event.
5. Before expiry, owner creates a replacement credential, updates the environment variable, and restarts the Codex host.
6. Owner revokes the old credential and verifies it no longer authenticates.

Plaintext credentials cannot be recovered from list/get. Rotation always creates a new credential.

## Production closeout boundary

The OpenAI production smoke workflow is manual and protected by an exact confirmation input. It may create one 15-minute `provider=openai` credential, run read-only compatibility and denial checks, revoke it in the same run, verify revoked denial, scan evidence for token patterns, and upload only redacted evidence.

Creating or running that production credential lifecycle requires explicit owner approval. Merging this foundation does not itself issue a credential or register a connector in an OpenAI product.

## Explicitly unsupported or deferred

- ChatGPT web authenticated app registration with the current opaque static Bearer credential;
- new OAuth authorization-server infrastructure;
- OpenAI Responses API integration or any paid OpenAI API key;
- Codex cloud credential injection without a separately verified official contract;
- write, merge, deploy, rollback, approval, or credential-management tools;
- public plugin directory submission;
- autonomous connector registration or credential rotation;
- owner token use by ChatGPT or Codex.
