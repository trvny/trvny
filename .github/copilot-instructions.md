# Copilot instructions for trvny/trvny

Use `AGENTS.md` as the primary repository contract. These instructions add Copilot-specific guidance and should not duplicate every detail from that file.

## Repository role

This private repository is `trvny`'s personal control room: profile content, reusable configurations, scripts, feeds, skills, and links to active projects. Prefer consolidation over fragmentation.

## Communication

- Use the language of the current request. Polish may be casual and direct.
- Lead with the result or recommendation.
- Avoid automatic praise, corporate filler, theatrical expertise, and routine follow-up offers.
- Ask only questions that materially block a useful answer or safe execution.
- For ordinary questions, answer normally. Do not manufacture a plan, agent, or workflow.
- Do not expose private chain-of-thought. Provide a concise rationale and verification instead.

## Repository work

- Inspect existing files and conventions before editing.
- Prefer small, reversible changes.
- Reuse existing scripts, skills, configuration, and folders before creating new structures.
- Do not add a framework, abstraction, dependency, or subagent unless it removes real repeated complexity.
- Keep generated state separate from hand-maintained sources.
- Do not modify lockfiles unless dependencies actually change.
- Preserve unrelated user changes.

## Validation

Detect the local stack from project files and use existing commands from `package.json`, `pyproject.toml`, `Makefile`, `gradlew`, or project documentation.

Before completion:

- run relevant tests, lint, type checks, and build when available,
- validate links and paths in documentation,
- report exactly what was not verified,
- distinguish full success from partial success.

## Technology preferences

The workspace may contain TypeScript, JavaScript, Python, Kotlin, Gradle, Android, JSON, YAML, TOML, Cloudflare Workers or Pages, OpenAI/Codex tooling, MCP integrations, and LLM skills. Do not assume one global stack.

For Cloudflare work:

- prefer `wrangler.jsonc` for new Workers projects,
- set an explicit `compatibility_date`,
- keep secret values out of Git,
- enable compatibility flags and observability only when the project needs them.

For OpenAI agent work:

- keep instructions separate from tools, guardrails, handoffs, sessions, tracing, and permissions,
- use the Responses API for short application-owned loops and the Agents SDK when managed tools, handoffs, sessions, guardrails, or tracing provide real value,
- use subagents only for independent work streams, specialization, or separate verification.

For Microsoft or Azure work, verify unstable technical details against current Microsoft Learn documentation.

## Security

Never commit API keys, access tokens, cookies, private keys, `.env`, `.dev.vars`, or local credentials. Example files may contain variable names and inert placeholders only.

## Final response

Report briefly:

- what changed,
- which files changed,
- which checks ran,
- what remains unverified,
- whether a user decision is still required.
