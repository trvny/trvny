# Technology Stack

There is no root application manifest. Each active component owns its toolchain.

| Component | Runtime / language | Main tools |
| --- | --- | --- |
| Kanarek Companion / GPTomek | Cloudflare Workers, TypeScript 7, Node 24 CI | Wrangler 4, Node test runner |
| status-mcp | Cloudflare Workers, TypeScript 7, Node 24 CI | Wrangler 4, strict typecheck |
| Pet Dispatcher local worker | Node, TypeScript 7 | MCP SDK, Zod, `tsx`, Microsoft MXC SDK |
| Pet Dispatcher control plane | Cloudflare Workers, TypeScript 7 | Wrangler 4, Queues, Durable Objects |
| Loopling | Python generator + static JSON/WebP assets | Python, shell/PowerShell installers |
| Remotely Save GDrive patch | Python + Node verification harness | Python patch/build scripts, Node test runner |
| Token Worldcup report | Quarto | Quarto 1.10.18 in CI |

## Key commands

```bash
(cd gh-apps/kanarek-companion && npm ci && npm run check)
(cd mcp/status-mcp && npm ci && npm run typecheck)
(cd mcp/pet-dispatcher && npm ci && npm run check)
python loopling/tools/generate.py
```

## Repository tooling

- MegaLinter checks documentation/configuration quality.
- GitHub Actions uses Node 24 for the Worker packages that run in CI.
- `.ai/core` is a Git submodule; `.ai/profile.yaml` and `.ai/private/` are local overlays/reference material.
- `.gitattributes` defines repository line-ending rules and generated workflow-lock treatment.
