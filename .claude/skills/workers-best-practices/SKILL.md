---
name: workers-best-practices
description: Review or author Cloudflare Workers code using the project's installed toolchain, Wrangler configuration, tests, and current Cloudflare documentation. Use for Worker runtime, bindings, caching, streaming, async work, security, observability, and deployment changes. Do not apply a frozen command catalog or assume one chat sandbox.
---

# Cloudflare Workers best practices

Workers APIs, Wrangler schemas, compatibility behavior, and product limits
change. Read the repository contract and current project files first, then use
official Cloudflare documentation for unstable details.

## Source priority

For an existing project, use this order:

1. nearest `AGENTS.md` and explicit task constraints;
2. `wrangler.jsonc`, `wrangler.toml`, or generated configuration;
3. package scripts, lockfile, installed Wrangler schema, generated types, and
   active CI workflows;
4. current Cloudflare documentation for the feature and compatibility date;
5. nearby tests and measured runtime behavior.

The latest published package describes what exists now. The project's installed
version describes what this checkout can build and deploy. Do not silently
install `@latest`, replace the lockfile, or review an old project against a newer
uninstalled type package.

## Before changing code

- Identify the Worker entry point, compatibility date and flags, bindings,
  environment, routes, and deployment workflow.
- Determine whether the task is local code work, configuration, a binding or
  migration change, or an external deployment.
- Retrieve the current Cloudflare docs for APIs, commands, limits, and config
  fields that affect the change.
- Prefer the project's package-manager scripts. Install locked dependencies only
  when appropriate and authorized.

## Review and implementation checks

### Configuration

- Keep binding names consistent across config, generated types, code, tests, and
  documentation.
- Preserve an existing configuration format unless a migration is part of the
  task. JSONC may be preferred for new projects, but TOML is not a defect by
  itself.
- For a new project, follow current Cloudflare guidance for the compatibility
  date and flags. For an existing project, update them deliberately and test the
  behavior changes rather than treating the date as cosmetic.
- Generate binding types with the project's Wrangler version when that is the
  project convention. Do not overwrite a deliberate type setup without reading
  it.
- Keep secrets out of source, `vars`, examples, logs, and generated files.

### Runtime behavior

- Bound or stream large and unknown-size bodies. Buffering small, known payloads
  can be reasonable.
- Track every promise that must finish. Use the correct request lifecycle tool,
  such as `waitUntil`, only where the current API and delivery guarantees fit.
- Keep request-scoped mutable state out of module globals.
- Prefer bindings for Cloudflare services when they fit the architecture, but
  do not rewrite a working external integration merely to satisfy a slogan.
- Verify serialization rules at Queue, Workflow, Durable Object, RPC, cache, and
  storage boundaries against the current product docs.
- Validate untrusted input and preserve intentional error, retry, idempotency,
  and fallback behavior.

### Security and operations

- Use secure randomness and current cryptographic APIs for security-sensitive
  values. Verify the exact API in the target compatibility environment.
- Do not expose credentials, private binding identifiers, account data, request
  bodies, or user data in logs or examples.
- Treat D1 migrations, Durable Object migrations, binding changes, secret
  changes, deployments, rollbacks, and resource deletion as explicit external
  operations.
- Use least-privilege permissions and the repository's existing deployment
  path. Do not reconstruct a direct Cloudflare API deployment from remembered
  metadata when Wrangler or CI owns deployment.
- Preserve observability that helps diagnose the changed path. Do not add noisy
  or sensitive logging by default.

## Validation

Use the narrow commands defined by the project. Typical checks may include:

```bash
npm ci
npm run typecheck
npm test
npx wrangler types
npx wrangler deploy --dry-run
```

Run only commands supported by the installed project and relevant to the change.
A dry run is not a live deployment. A compile is not proof of production binding
behavior, and a successful commit is not proof that a deployment completed.

For live behavior, state whether it was verified locally, against a development
environment, in CI, or not verified. Never invent platform results.

## Completion

Report briefly:

- Worker and environment affected;
- source and configuration files changed;
- current documentation or schema consulted;
- local checks and observed CI;
- migrations, bindings, secrets, or deployment actions performed;
- live behavior still requiring verification.
