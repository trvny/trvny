# MechaGremlin plugin foundation

This directory is the migration source for the MechaGremlin Custom GPT.

It intentionally does **not** duplicate Gremlin Operator logic. The shared
`kanarek-companion` Worker remains the source of truth for authorization,
GitHub policy, GPTomek-attributed writes, Cloudflare access, specialist tools,
replay protection, and runtime behavior.

The initial package connects only the existing OAuth-protected Streamable HTTP
MCP at `/mcp`. That MCP currently exposes bounded specialist tools. Operator
parity for GitHub, Cloudflare, release, workflow, and maintenance actions is
tracked in the skill migration reference and must be added to the shared runtime
before the legacy Custom GPT is retired.

Do not create a second production plugin from this source yet. The ChatGPT
migration flow should create the eventual private plugin from the existing GPT,
preserving its instructions and knowledge files. This package is then the
maintained source for the plugin-specific tool layer.

No credentials, OAuth tokens, private keys, or copied GPT knowledge files belong
in this directory.
