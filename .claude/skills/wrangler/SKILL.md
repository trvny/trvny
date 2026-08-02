---
name: wrangler
description: Use the Wrangler CLI safely for Cloudflare Workers projects. Discover the project's pinned Wrangler version, package scripts, configuration, environment, and current official command syntax before acting. Use for local development, types, dry runs, bindings, migrations, deployments, logs, secrets, and resource management. Require authorization for remote or destructive operations.
---

# Wrangler CLI

Wrangler changes quickly, and its subcommands span harmless local inspection,
remote reads, billable writes, deployments, migrations, and deletion. Do not use
this skill as a frozen command reference. Retrieve current Cloudflare docs and
inspect the project's installed version before constructing a command.

## Establish project context

Read:

- nearest `AGENTS.md`;
- `package.json` and the lockfile;
- `wrangler.jsonc`, `wrangler.toml`, or generated config;
- active CI and deployment workflows;
- migration directories and generated types where relevant.

Prefer the project's package-manager script or locally installed Wrangler. Check
the version with the command appropriate to that package manager. Running
`npx wrangler` in a project without Wrangler installed can fetch a newer version
than CI uses, so do not use it casually as a substitute for the locked toolchain.

Do not install or upgrade Wrangler merely to run one command unless the task
includes that dependency change. If dependencies are missing, restore the
locked environment with the project's package manager when appropriate.

## Retrieve exact syntax

Use current official Cloudflare documentation or the installed CLI help for the
specific product and version:

```bash
npm exec wrangler -- --version
npm exec wrangler -- --help
npm exec wrangler -- <command> --help
```

Adapt the launcher for npm, pnpm, yarn, bun, or an existing package script. Do
not paste a memorized flag into production automation without checking that the
installed version supports it.

The local Wrangler config and bundled schema are the source of truth for this
project's fields and bindings. Current online docs are the source for newly
available features and platform behavior. Reconcile both instead of silently
reviewing old code with a new unpinned CLI.

## Classify the operation

Before running a command, classify it:

### Local and normally reversible

Examples include version/help output, local type generation, configuration
inspection, tests, and a supported deploy dry run. These can still modify local
files or dependencies, so inspect the command and diff afterward.

### Remote read

Examples include account identity, logs, resource listings, and remote database
queries. These require authentication and may expose private account data.
Perform them only when needed for the task and summarize sensitive output
carefully.

### Remote write

Examples include deployment, version upload or rollout, setting secrets,
creating resources, applying remote migrations, writing KV/R2/D1 data, and
changing routes or bindings. Require an explicit request and authorization.
Confirm the target account, Worker, environment, and resource before execution.

### Destructive or hard to reverse

Examples include deleting Workers or resources, dropping data, rolling back or
replacing production state, and deleting secrets. Require explicit authorization
for the exact operation and verify backups or recovery paths when applicable.

## Configuration rules

- Preserve the project's existing config format and environment model unless a
  migration is requested.
- Keep the compatibility date and flags explicit. Update them deliberately with
  current docs and tests, not as drive-by cleanup.
- Keep binding names synchronized across config, code, generated types, tests,
  migrations, and documentation.
- Keep secret values out of config, shell history, logs, PR text, and source.
  Use the platform's supported secret mechanism.
- Never copy account IDs, namespace IDs, database IDs, tokens, or private routes
  from one project or environment without verifying the intended target.
- Preserve project-specific deployment scripts and CI conventions. A generic
  Wrangler command is not automatically safer than the repository workflow.

## Common workflows

### Local validation

Use the project's scripts first. Depending on the repository, relevant checks
may include locked dependency installation, type generation, typecheck, tests,
lint, and a dry-run bundle. Read the current `package.json` rather than assuming
script names.

### Binding or migration change

Update config, generated types, code, tests, and migrations as one coherent
change. Apply migrations locally first when the project supports it. Do not
apply remote D1 or Durable Object migrations as an incidental validation step.

### Deployment

Before deployment:

1. confirm account, Worker name, environment, routes, bindings, and secrets;
2. inspect the final diff and relevant CI;
3. use the repository's deployment workflow or installed Wrangler version;
4. perform the external action only when explicitly requested;
5. observe the actual deploy result and smoke-test the changed path.

A dry run proves bundling, not authentication, migrations, bindings, routes, or
live runtime behavior. A push to `main` proves neither upload nor rollout.

### Logs and production diagnosis

Limit scope and duration. Avoid printing request bodies, credentials, personal
data, or unbounded logs. Correlate logs with a concrete version, deployment, or
request and distinguish platform failures from application failures.

## Failure handling

- Read the full command error and current help before changing flags.
- Distinguish missing local dependencies, authentication, permissions, wrong
  account/environment, invalid config, API rejection, and application failure.
- Do not work around an authentication or permission error by embedding a token
  in source or constructing an undocumented direct API request.
- Never claim a deployment, migration, secret change, or resource operation
  succeeded without observing its result.

## Completion

Report briefly:

- repository and installed Wrangler version;
- target account/Worker/environment when a remote operation was authorized;
- exact class of operation performed;
- files or resources changed;
- local validation and observed CI/deployment result;
- anything not executed or not verified live.
