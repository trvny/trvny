---
applyTo: "**/wrangler.jsonc,**/wrangler.toml,**/workers/**,**/functions/**"
---

# Cloudflare project instructions

Use these rules only for files that are clearly part of a Cloudflare project.
For Worker source stored in a generic `src/` directory, add a narrower
`.instructions.md` file inside that project rather than applying Cloudflare
rules to every TypeScript or JavaScript file in the repository.

- Treat the local Wrangler configuration as the deployment source of truth.
- Prefer `wrangler.jsonc` for new projects unless an existing project already
  uses TOML.
- Keep `compatibility_date` explicit and update it deliberately.
- Add compatibility flags only when a dependency or runtime feature requires
  them. Do not enable `nodejs_compat` by habit.
- Never commit `.dev.vars`, secret values, API tokens, credentials, private
  keys, or session data.
- Keep binding names consistent across configuration, code, tests, generated
  types, and documentation.
- Distinguish ordinary variables from secrets, KV, D1, R2, queues, services,
  and Durable Objects.
- Use existing project scripts for type checks, tests, lint, Wrangler checks,
  and deployment.
- Do not deploy or modify Cloudflare resources unless explicitly requested and
  authorized.
- Report the target environment, changed bindings, validation performed, and
  anything not deployed.
- Verify unstable configuration details against current official Cloudflare
  documentation.
