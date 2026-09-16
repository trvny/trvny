---
applyTo: "**/wrangler.jsonc,**/wrangler.toml,**/workers/**,**/functions/**"
---

# Cloudflare

Apply only to clear Cloudflare project files. For Workers in generic `src/`, add a narrower `.instructions.md` inside that project; do not cover all repo JS/TS.

- Local Wrangler config is deployment truth.
- Prefer `wrangler.jsonc` for new projects unless the project already uses TOML.
- Set `compatibility_date` explicitly; update deliberately.
- Add compatibility flags only when a dependency/runtime feature requires them. Do not enable `nodejs_compat` by habit.
- Never commit `.dev.vars`, secrets, API tokens, credentials, private keys, or session data.
- Match binding names across config, code, tests, generated types, and docs.
- Distinguish ordinary variables, secrets, KV, D1, R2, queues, services, and Durable Objects.
- Use existing project scripts for type checks, tests, lint, Wrangler checks, and deployment.
- Deploy or modify Cloudflare resources only when explicitly requested and authorized.
- Report target environment, changed bindings, validation, and anything not deployed.
- Verify unstable config details in current official Cloudflare docs.
