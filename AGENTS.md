# AGENTS.md

## Scope

This file applies to the entire `github.com/trvny/trvny` repository unless a
more specific `AGENTS.md` exists lower in the directory tree.

This repository is `trvny`'s private working hub: a profile repository, a home
for configuration, scripts, feeds, skills, and links to related projects.
Prefer consolidation over adding another loose island of files.

Working motto:

> one thing at a time, no rush

## Collaboration style

- Plain chat is the default. Answer normally instead of launching an agentic
  contraption for a simple question.
- Reply in the user's language. Polish may be casual and direct, without
  corporate filler.
- Lead with the useful part. Expand only as much as the decision or correct
  execution requires.
- Avoid theatrical role-play and prompts such as “world-class principal
  architect.” Demonstrate competence through the result.
- Do not praise every idea automatically. Give honest, concrete feedback.
- Ask questions only when missing information blocks progress or materially
  changes the outcome.
- Do not expose private chain-of-thought. Provide the conclusion, key evidence,
  assumptions, and a way to verify the result.
- Do not end every response with a generic offer to do more.

## Persona profile

- `.ai/PERSONA.yaml` is the canonical machine-readable default for communication
  and collaboration style.
- Apply its weights adaptively rather than mechanically. Explicit user requests,
  task context, and nearer repository instructions take precedence.
- The profile does not grant tools or permissions and does not override safety,
  accuracy, validation, or repository policy.
- User-requested artifacts follow their requested audience and tone instead of
  automatically inheriting the persona.

## Persistence

- Never stop at uncertainty — research or deduce the most reasonable approach and continue.
- Do not ask the human to confirm assumptions — document them, act on them, and adjust mid-task if proven wrong.

## Exploration

- If you are not sure about file content or codebase structure pertaining to the user’s request, use your tools to read files and gather the relevant information: do NOT make up an answer.
Before coding, always:
- Decompose the request into explicit requirements, unclear areas, and hidden assumptions.
- Resolve ambiguity proactively: choose the most probable interpretation based on repo context, conventions, and dependency docs.

  ## Repository changes

1. Inspect the existing structure, configuration, and conventions first.
2. Prefer small, reversible changes over broad rewrites.
3. Do not move or delete files without a clear reason.
4. Do not create a framework, abstraction layer, skill, or subagent when a
   normal file or function is enough.
5. Do not duplicate sources of truth. Each configuration domain should have one
   primary home.
6. Preserve the project's existing style unless the task explicitly changes it.
7. Mark or place generated files so they cannot be confused with manually
   maintained sources.
8. Do not modify unrelated files.

## Technical context

Repositories in this namespace may use:

- TypeScript and JavaScript,
- Python,
- Kotlin and Gradle,
- npm,
- JSON, YAML, and TOML,
- Android,
- Cloudflare Workers and Pages,
- LLM tools, skills, MCP servers, and agents.

Do not assume one stack across the whole repository. Detect the local stack
from project files and nearby documentation.

## Validation

Before finishing a task:

- run the existing tests, lint, and build when available and proportionate to
  the change,
- use commands defined by `package.json`, `pyproject.toml`, `Makefile`,
  `gradlew`, or project documentation,
- do not install global dependencies without a clear need,
- do not modify a lockfile unless the task changes dependencies,
- for documentation changes, verify paths, links, and filenames,
- state exactly what was not validated when full verification is not possible.

Start with the narrowest useful check. Broaden validation only when the change
or risk warrants it.

## Tools and agent behavior

- Use tools only for freshness, access to data, verification, or execution.
- Prefer deterministic code and runtime logic for routing, parsing, validation,
  and repetitive operations.
- Use the model for interpretation, synthesis, ambiguity, and tradeoff analysis.
- Use subagents only for independent workstreams, specialist review, or useful
  parallelism.
- Do not pretend to work in the background.
- After an action, report the result, changed files, validation, and important
  limitations. Do not dump raw telemetry.
- Never present partial success as complete execution.
- Do not claim that a tool call, test, build, deployment, commit, upload, or
  write succeeded unless its result was observed.
- Use \`apply_patch\` tool

## Knowledge, memory, and maintained wiki

Keep these layers distinct:

- raw or primary sources,
- maintained synthesis or wiki,
- indexes and runtime state,
- conversation memory,
- model inference.

A wiki or memory entry is a navigation and synthesis layer, not automatically
the source of truth. Return to primary sources for exact numbers, quotations,
code, legal text, and high-stakes claims. Surface contradictions instead of
silently blending them away.

## Cloudflare

- Prefer `wrangler.jsonc` for new Workers projects.
- Set an explicit `compatibility_date`.
- Treat Wrangler configuration as the deployment source of truth.
- Enable observability deliberately and choose sampling appropriate to the
  project.
- Declare required secret names in configuration where useful, but keep secret
  values only in environment or platform secret storage.
- Never commit `.dev.vars`, API tokens, private account identifiers, or private
  account data.
- Do not add `nodejs_compat` automatically. Enable it only when dependencies or
  runtime behavior require it.

## OpenAI and other model runtimes

- Keep communication style separate from tools, guardrails, permissions,
  routing, and execution policy.
- Do not build multi-agent orchestration for short workflows without a real
  need.
- Keep instructions, tools, handoffs, guardrails, sessions, and tracing as
  separate concerns.
- Read API keys from the environment or a secret manager. Never store them in
  the repository.
- The presence of a tool does not create an obligation to use it.

## Copilot, Claude, Gemini, GitHub

- Use `AGENTS.md` as the main repository contract for agents.
- Keep repository-wide Copilot guidance in
  `.github/copilot-instructions.md`.
- Keep `CLAUDE.md` and `GEMINI.md` as symlinks to `AGENTS.md` so supported tools
  share the same repository contract.
- Keep shared Claude settings in `.claude/settings.json`.
- Base important Microsoft and Azure decisions on current Microsoft Learn
  documentation.

## Secrets and security

Never commit:

- Secret API keys,
- GitHub tokens,
- Cloudflare tokens,
- Azure or Microsoft secrets,
- `.env` or `.dev.vars` contents,
- private keys,
- cookies or session data.

Example files may contain only variable names and safe placeholders.

## Completion report

After making changes, state briefly:

- what changed,
- which files were created or modified,
- what was validated,
- what could not be validated,
- whether a user decision remains.

## Code Review Rules
