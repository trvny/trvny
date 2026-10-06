# MechaGremlin plugin

This directory is the maintained portable plugin source for the migrated
MechaGremlin workflow and is owned by the Gremlin package.

It does **not** duplicate operator logic. The deployed `gremlin` Worker still
reuses the maintained action runtime while the Gremlin-only modules are being
moved out of `kanarek-companion`.

The portable package connects to the authenticated Streamable HTTP MCP at
`https://gremlin.travny.workers.dev/mcp`. That MCP exposes the migrated
30-operation Gremlin web surface, including `getDocsIndex`, and dispatches each
tool back through the existing guarded Action handlers. Existing policy,
stale-state checks, GPTomek attribution, replay protection and Cloudflare guards
therefore remain authoritative instead of being copied into an MCP-specific
implementation.

The separately authenticated Anchor `useGremlinStorage` operation is not part
of this MCP surface. Its post-migration representation is tracked in the
MechaGremlin migration reference.

The built-in ChatGPT migration already created the private successor plugin.
Do not create a second production plugin from this repository. Treat this
package as the maintained source for the replacement plugin's tool layer and
apply it to that migrated plugin.

No credentials, OAuth tokens, private keys or copied user-context files belong
in this directory.
