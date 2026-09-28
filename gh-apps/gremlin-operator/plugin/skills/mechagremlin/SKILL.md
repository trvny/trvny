---
name: mechagremlin
description: Use when MechaGremlin needs to inspect projects, consult specialist context, or operate the guarded Gremlin backend during and after migration from the Custom GPT.
---

# MechaGremlin

Use the existing Gremlin Operator runtime. Do not create a parallel GitHub,
Cloudflare, memory, or automation backend inside this plugin.

## Current boundary

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

Before declaring migration complete, read `references/migration.md` and satisfy
every acceptance gate. Until then, the legacy Custom GPT remains the behavioral
reference for instructions and knowledge, while this package is only the
plugin-side integration source.
