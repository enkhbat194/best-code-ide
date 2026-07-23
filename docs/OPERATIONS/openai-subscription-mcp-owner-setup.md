# OpenAI Subscription MCP — Owner Setup

This workflow connects Codex CLI, the Codex IDE extension, or the ChatGPT desktop app to the BestCode read-only production MCP endpoint. It never gives the OpenAI client the owner master token.

## Supported initial clients

- Codex CLI
- Codex IDE extension
- ChatGPT desktop app using the shared Codex-host configuration

ChatGPT web developer-mode apps are not supported by this static scoped-Bearer workflow. Authenticated ChatGPT web apps are expected to use OAuth 2.1. Do not put the scoped credential in the URL.

## Fixed contract

```text
Server URL: https://best-code-ide.enkhbat194.workers.dev/mcp/subscription?project_id=bestcode
Provider: openai
Agent name: chatgpt-codex
Authorization header: Authorization: Bearer <scoped credential>
Local secret environment variable: BESTCODE_OPENAI_SUBSCRIPTION_TOKEN
Credential lifetime: short-lived; 15 minutes for smoke, owner-selected up to 30 days for normal use
```

The exact allowed tools are:

```text
projects_list
project_get
brain_search
brain_export_summary
mission_get
mission_context_get
repository_status
repository_read_file
repository_search
pull_request_status
deployment_status
handoff_packet_build
```

## 1. Create one scoped credential

Keep the owner token only in a protected local environment variable. Never paste it into ChatGPT, Codex, the MCP URL, a repository file, or a screenshot.

Example shell flow with `curl` and `jq`:

```bash
response="$({
  curl --fail --silent --show-error \
    -X POST \
    -H "Authorization: Bearer ${BESTCODE_OWNER_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-BestCode-Request-Id: owner-openai-setup-$(date +%s)" \
    --data '{
      "project_id": "bestcode",
      "agent_name": "chatgpt-codex",
      "provider": "openai",
      "expires_in_seconds": 86400,
      "note": "OpenAI subscription MCP owner connection"
    }' \
    https://best-code-ide.enkhbat194.workers.dev/api/subscription/credentials
})"

export BESTCODE_OPENAI_SUBSCRIPTION_TOKEN="$(printf '%s' "$response" | jq -r '.secret')"
export BESTCODE_OPENAI_SUBSCRIPTION_CREDENTIAL_ID="$(printf '%s' "$response" | jq -r '.credential.credential_id')"
printf '%s\n' "$response" | jq '{credential: .credential, secret_display: .secret_display}'
unset response
```

The raw secret is returned once. `list` and `get` cannot recover it.

## 2. Configure the shared Codex MCP host

Edit the user configuration file:

```text
~/.codex/config.toml
```

A trusted project may instead use `.codex/config.toml`, but a user-level file is safer for a secret-backed production connection because the repository must never contain the token.

Add:

```toml
[mcp_servers.bestcode]
url = "https://best-code-ide.enkhbat194.workers.dev/mcp/subscription?project_id=bestcode"
bearer_token_env_var = "BESTCODE_OPENAI_SUBSCRIPTION_TOKEN"
enabled_tools = ["projects_list", "project_get", "brain_search", "brain_export_summary", "mission_get", "mission_context_get", "repository_status", "repository_read_file", "repository_search", "pull_request_status", "deployment_status", "handoff_packet_build"]
default_tools_approval_mode = "writes"
startup_timeout_sec = 20
tool_timeout_sec = 45
enabled = true
```

The file contains only the environment-variable name, never the raw credential.

## 3. Make the environment variable visible to the client

### Codex CLI

Launch Codex from the same terminal where `BESTCODE_OPENAI_SUBSCRIPTION_TOKEN` is set.

### Codex IDE extension

Set the variable in the environment that launches the IDE, then fully restart the IDE. Do not add the token to workspace settings, `.env` files tracked by Git, or extension configuration JSON.

### ChatGPT desktop app

The desktop app shares the Codex-host MCP configuration. Make the environment variable available to the desktop process, fully exit the app, then reopen it. In the app, open **Settings → MCP servers** and verify `bestcode` is enabled. The fine-grained URL, environment-variable authorization, allowlist, and approval policy remain controlled by `config.toml`.

## 4. Test the connection

For Codex CLI:

```bash
codex mcp list
```

Inside Codex CLI, the IDE extension, or ChatGPT desktop, open the MCP server list with `/mcp`. Verify that `bestcode` is connected and that exactly twelve tools are shown.

Run this smoke request through the agent:

```text
Use BestCode project_get with project_id=bestcode. Return the structured result and do not call any mutation tool.
```

Expected result:

- `ok=true`;
- project `bestcode`;
- actor ID `chatgpt-codex`;
- provider `openai`;
- MCP profile `subscription-readonly` in audit metadata.

## 5. Verify the audit event

Use the owner token only against the owner audit endpoint:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${BESTCODE_OWNER_TOKEN}" \
  "https://best-code-ide.enkhbat194.workers.dev/api/security/audit?event=mcp_tool_call&limit=20" \
  | jq '.items // .'
```

Find the event matching the credential ID. Verify project `bestcode`, agent `chatgpt-codex`, provider `openai`, the called tool, and the outcome. The event must not contain an authorization header or raw scoped credential.

## 6. Revoke the credential

```bash
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer ${BESTCODE_OWNER_TOKEN}" \
  "https://best-code-ide.enkhbat194.workers.dev/api/subscription/credentials/${BESTCODE_OPENAI_SUBSCRIPTION_CREDENTIAL_ID}/revoke" \
  | jq '.credential | {credential_id, status, revoked_at}'

unset BESTCODE_OPENAI_SUBSCRIPTION_TOKEN
unset BESTCODE_OPENAI_SUBSCRIPTION_CREDENTIAL_ID
```

Restart the OpenAI client and confirm that `bestcode` can no longer authenticate.

## 7. Rotate without widening permission

1. Create a new credential with the same `project_id=bestcode`, `agent_name=chatgpt-codex`, and `provider=openai`.
2. Replace only `BESTCODE_OPENAI_SUBSCRIPTION_TOKEN` in the client environment.
3. Restart the Codex host and repeat `project_get` plus audit verification.
4. Revoke the old credential.
5. Keep the server URL and exact twelve-tool allowlist unchanged.

## Fail-closed checks

The setup is invalid if any of these occur:

- owner token is entered into an OpenAI client;
- scoped token appears in the URL, repository, documentation, log, fixture, or artifact;
- `/mcp` is used instead of `/mcp/subscription`;
- a project other than `bestcode` is accepted;
- more or fewer than twelve tools are discovered;
- a mutation tool is callable;
- request headers override agent/provider identity;
- an expired or revoked credential still authenticates.
