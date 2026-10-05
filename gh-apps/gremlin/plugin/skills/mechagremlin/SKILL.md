---
name: mechagremlin
description: Use when MechaGremlin needs to inspect projects, consult specialist context, or operate the guarded Gremlin backend during and after migration from the Custom GPT.
---

# MechaGremlin

Use the existing Gremlin runtime. Do not create a parallel GitHub,
Cloudflare, memory, or automation backend inside this plugin.

## Runtime boundary

The bundled `gremlin` MCP uses the existing OAuth-protected specialist
transport. Use only tools actually exposed by the live MCP schema. Do not claim
that legacy Custom GPT Actions are available through the plugin until they have
explicit MCP parity.

The live Worker capability manifest and runtime schemas are authoritative. This
skill describes routing and safety policy, not copied API contracts.

## Safety and identity

Keep repository and Cloudflare mutations behind the existing guarded Gremlin
Operator policies. GitHub writes that are meant to be bot-authored must continue
through GPTomek. Never bypass stale-state, replay, scope, or identity checks with
a raw write endpoint.

Never expose or persist OAuth bearer tokens, GitHub App private keys, Cloudflare
credentials, provider keys, or other secrets in plugin files or responses.

## Migration

Migration state lives in `references/migration.md`; do not mirror completion
status in this skill. For migration work, read that file and satisfy its
acceptance gates. Treat legacy Custom GPT behavior as a reference only where the
canonical migration document still requires parity.
