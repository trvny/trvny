---
name: skill-compat-audit
description: Audit a Claude skill for the exact target where it will run, such as Claude, Claude Code, an organization upload, or an API code-execution environment. Use when a skill fails to upload, does not trigger, references unavailable tools, or is being ported between runtimes. Verify current Anthropic documentation and available validators instead of enforcing a remembered metadata allowlist or sandbox layout.
license: Complete terms in LICENSE.txt
---

# Skill compatibility audit

A skill can be valid in one Claude runtime and wrong in another. Start by naming
the target and checking its current official documentation. Do not treat old
frontmatter lists, connector names, filesystem paths, or packaging commands as
universal rules.

## 1. Identify the target

Record where the skill will run:

- Claude custom skills uploaded by an individual or organization;
- Claude Code project or user skills;
- an API environment with code execution;
- another harness that merely uses a similar `SKILL.md` convention.

These environments may differ in packaging, dependency installation, available
tools, persistence, and invocation. A compatibility audit without a target is
mostly astrology wearing YAML.

## 2. Validate structure and metadata

Check the current target documentation and any validator shipped with that
environment. At minimum:

- the skill directory and core Markdown file are where the target discovers
  them;
- required metadata such as `name` and `description` is present and valid;
- the description states both what the skill does and when it should run;
- optional metadata is supported by the target and used only when needed;
- every referenced script, resource, and relative path exists in the package;
- folder and archive layout matches the upload or installation mechanism.

Do not delete an unknown metadata key merely because an old note omitted it.
Confirm whether the target supports, ignores, or rejects it. Likewise, do not
invent dependencies or permissions that the target cannot honor.

## 3. Audit runtime assumptions

Search the skill and supporting files for assumptions about:

- tool or connector names;
- shell commands and installed binaries;
- authentication and secret availability;
- writable paths and persistent storage;
- network access;
- subagents, slash commands, hooks, settings, or MCP servers;
- package installation at runtime;
- repository checkout and GitHub authentication.

Replace brittle assumptions with capability checks where possible. For example,
say "use an authenticated repository tool available in the current environment"
instead of naming one connector function forever. Keep a concrete command only
when it belongs to the target's documented stable interface.

Do not claim that Claude, Claude Code, API code execution, or a chat sandbox
always has or lacks a particular tool. Inspect the actual environment.

## 4. Preserve the workflow, not the scaffolding

When porting a skill, retain its useful method and guardrails while adapting the
execution layer:

- move large optional detail into referenced files;
- replace unavailable automation with explicit inline steps;
- replace machine-specific paths with package-relative paths;
- make secret and deployment actions explicit and authorized;
- keep the original skill name when updating an installed skill unless a rename
  is intentional;
- avoid copying private identifiers, account IDs, tokens, or local paths into a
  portable package.

Do not solve incompatibility by deleting the part that performs the actual job.

## 5. Test invocation and execution

Use the current platform's supported validation or upload flow. Then test with:

- a prompt that should clearly invoke the skill;
- a nearby prompt that should not invoke it;
- a normal successful case;
- a missing-tool, missing-resource, or invalid-input case relevant to the
  workflow.

Observe the result. An accepted package that never triggers is still broken, and
a triggering skill that cannot execute its referenced steps is only decorative
plumbing.

When a validator is available, run the validator discovered in the installed
version or official examples. Do not hardcode a private `/mnt/...` path or an
unversioned helper module as repository policy.

## 6. Report

For each audited skill, report briefly:

- target runtime;
- upload or discovery blockers;
- stale runtime assumptions;
- files changed;
- validator or installation result;
- invocation tests and remaining environment-specific limitations.

## Guardrails

- Current target documentation beats this skill.
- Required metadata and package layout must be verified, not remembered.
- Never paste credentials into a skill package or chat transcript.
- Do not claim cross-runtime compatibility without testing each target.
- Prefer capability-based instructions over connector catalogs and machine
  snapshots.
