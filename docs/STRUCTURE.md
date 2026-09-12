# Codebase Structure

## Top-level map

| Path | Purpose |
| --- | --- |
| `.ai/` | AI configuration core, private overlays and backups |
| `.github/` | workflows, Dependabot, linters, agents and repository automation |
| `assets/` | shared README/branding assets and status-mcp icon source |
| `docs/` | repository-level technical documentation |
| `gh-apps/` | Kanarek Companion, GPTomek bridge, GPT Actions and Gremlin Operator |
| `loopling/` | ChatGPT/Codex pet source, generated assets, installers and previews |
| `mcp/pet-dispatcher/` | local confined MCP worker plus Cloudflare remote control plane |
| `mcp/status-mcp/` | authenticated aggregate health MCP Worker |
| `remotely-save-gdrive-patch/` | local Google Drive patch and non-redistributing verification harness |
| `stuff/` | feeds, playlists, quotes, configs and miscellaneous personal tools/assets |

## Main entry points

| Component | Entry point / maintained source |
| --- | --- |
| Kanarek Companion | `gh-apps/kanarek-companion/src/runtime-entry.ts` |
| GPT Actions / Gremlin Operator | `gh-apps/kanarek-companion/src/router.ts`, `src/gpt-actions.ts`, `src/operator-actions.ts` |
| status-mcp | `mcp/status-mcp/src/entry.ts` |
| Pet Dispatcher local worker | `mcp/pet-dispatcher/src/index.ts` |
| Pet Dispatcher control plane | `mcp/pet-dispatcher/control-plane/entry.ts` |
| Loopling | `loopling/tools/generate.py` and `loopling/pet/pet.json` |
| Remotely Save patch | `remotely-save-gdrive-patch/patch_gdrive.py` |
| Token Worldcup | `stuff/other/token-worldcup/token-worldcup.qmd` |

## Ownership rules

- Keep Worker runtime/configuration beside the component that deploys it.
- Keep Pet Dispatcher host access inside its confined session/tool layer; the control plane only coordinates signed tasks and state.
- Treat `.qmd` as the source for Quarto-backed reports and generated HTML as derived output.
- Treat `.ai/backups/` as reference material, not active configuration.
- Use deeper `AGENTS.md` files when present; they override root guidance for their subtree.
