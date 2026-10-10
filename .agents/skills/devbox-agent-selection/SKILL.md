---
name: devbox-agent-selection
description: Choose among GitHub Copilot CLI, Google Antigravity CLI (agy) and Hermes Agent for Codespaces coding, planning, research, tools and provider routing while minimizing cost and duplicate agent runs.
---

# Choose one lead agent

1. Start with the task, repo instructions and `.devcontainer/README.md#agent-roles-and-first-run-configuration`; do not launch all three agents by default.
2. **Copilot CLI**: implementation, small/medium fixes, code review, repository workflow, tests and PR preparation.
3. **Antigravity CLI (`agy`)**: architecture, alternative designs, large multi-module refactors, plan/artifact review. Ask for a plan and inspect diffs before accepting writes.
4. **Hermes Agent**: multi-provider research and operations, scoped MCP tools, task-oriented skills, budget-sensitive routing and fallback. Use a restricted Kanarek broker once one exists.
5. Keep CI, schedules and repeatable jobs in GitHub Actions; use GPTomek for authorized bot actions and Pet Dispatcher as the existing task control plane.
6. Prefer existing remote APIs/MCP and provider quotas to local heavyweight services, but confirm billing and data boundaries.
7. Never pass production credentials into a general agent environment; secrets, paid models, destructive commands, external uploads and unattended workflows require explicit scope.
8. Preserve the repo's AGENTS.md, existing Copilot review instructions and project-local .agents/skills. Don't run `copilot init` in a repo already carrying maintained instructions.
9. Don't transfer models, tokens, sessions or credentials from another device until the owner can inspect those settings and authorize a scoped migration.
10. One lead agent per task, optionally a different agent for a **read-only** second opinion on high-risk changes; never two agents writing the same checkout concurrently.
