# Best Code IDE Roadmap

## v0.2 — Agent core (current)

- Repository tree and code search
- Multi-file read
- Branch creation and diff
- GitHub Actions validation
- ChatGPT Actions and MCP tool parity
- GitHub to mobile local workspace import
- Agent identity and chat history fixes

## v0.3 — Safe multi-file changes

- Workspace change set instead of one commit per file
- Unified patch application
- Changes tab with accept/reject per file
- One atomic commit for selected files
- Create Pull Request tool
- Revert and recovery flow

## v0.4 — Validation feedback loop

- Read workflow jobs and failed logs
- Agent automatically diagnoses failed build/test
- Bounded repair loop
- Validation status and logs UI
- Merge only after successful checks

## v0.5 — Remote execution and full preview

- Ephemeral sandbox per workspace
- npm/pnpm/yarn install
- Build, lint, test, and arbitrary approved commands
- React/Vite/Next/Vue preview URL
- Process and port management

## v0.6 — Provider layer

- OpenAI API adapter
- Anthropic API adapter
- Gemini API adapter
- DeepSeek/OpenRouter-compatible adapter
- Model picker and per-task routing
- Encrypted server-side provider credentials

## v1.0 — Mobile AI IDE

- Project/workspace manager
- GitHub OAuth
- MCP OAuth
- Full local/remote/GitHub sync with conflicts
- Branch, commit, push, Pull Request, review, merge
- Build/test/preview agent loop
- Audit log and permission policies
