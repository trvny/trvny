---
applyTo: "**/wrangler.jsonc,**/wrangler.toml,**/src/**/*.ts,**/src/**/*.js,**/functions/**,**/workers/**"
---

# Cloudflare project instructions

- Treat the local Wrangler configuration as the deployment source of truth.
- Prefer `wrangler.jsonc` for new projects unless an existing project already uses TOML.
- Keep `compatibility_date` explicit and update it deliberately, not incidentally.
- Add `compatibility_flags` only when a dependency or runtime feature requires them.
- Do not enable `nodejs_compat` by habit.
- Never commit secret values, `.dev.vars`, API tokens, account credentials, private keys, or session data.
- Example environment files may contain variable names and safe placeholders only.
- Keep bindings explicit and consistently named across configuration, code, tests, and documentation.
- Distinguish environment variables from secrets, KV namespaces, D1 databases, R2 buckets, queues, services, and Durable Objects.
- Prefer local deterministic validation before deployment.
- Use existing package scripts for type-checking, tests, lint, Wrangler validation, and deployment.
- Do not deploy or modify Cloudflare resources unless the task explicitly requests it and the runtime has the required authorization.
- Report the target environment, changed bindings, validation performed, and anything not deployed.
- For current Cloudflare behavior or configuration details, consult the latest official Cloudflare documentation rather than relying on memory.
