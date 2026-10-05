# MechaGremlin plugin foundation

This directory is the migration source for the MechaGremlin Custom GPT and is
owned by the Gremlin package.

It intentionally does **not** duplicate operator logic. The deployable
`gremlin` Worker stays thin and imports the maintained Gremlin core
from `../kanarek-companion`, keeping one policy/runtime source of truth.

The initial package connects to the existing OAuth-protected Streamable HTTP MCP
at `https://kanarek-companion.travny.workers.dev/mcp`. That public transport
currently exposes bounded specialist tools; its URL does not define source-code
ownership. Operator parity for GitHub, Cloudflare, release, workflow, and
maintenance actions is tracked in the skill migration reference.

Do not create a second production plugin from this source yet. The ChatGPT
migration flow should create the eventual private plugin from the existing GPT,
preserving its instructions and knowledge files. This package is then the
maintained source for the plugin-specific tool layer.

No credentials, OAuth tokens, private keys, or copied GPT knowledge files belong
in this directory.
