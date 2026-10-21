# GitHub Apps

GitHub App infrastructure for `trvny`.

- [Automation (shared Worker)](kanarek-companion/) is the common runtime for
  Kanarek Companion, GPTomek Bridge, Gremlin operator actions, and specialists.
  Its existing deployment and source directory remain `kanarek-companion` until
  the separately gated Cloudflare migration.
- [kanarek-review](kanarek-review/) is the private free-review provider Worker
  reached from the companion through a Cloudflare Service Binding.
- [GPTomek](gptomek/) is the coding bot identity and reuses the same Worker for
  installation authentication and GitHub API operations.
- [Claudiusz](claudiusz/) is a standalone MCP Worker (`claudiusz-mcp`) for
  Claude's comments, reactions and reviews as `claudiusz69[bot]`.
- [Gremlin](gremlin/) is the OAuth-guarded operator Worker (`gremlin`); it
  bundles the companion action runtime.
- [Shitpost Reactor](shitpost-reactor/) is a scheduled meme/post publisher
  Worker.
- [core](core/) holds dependency-free modules shared by more than one Worker
  (GitHub App auth, review-service protocol). Cross-app imports go through
  `core/`, never into another app's `src/`.

**Automation** is the logical runtime name. `kanarek-companion` is still its
Cloudflare script and package identifier, not a label for every subsystem.
Keep private keys only in Worker secrets. Migration details and invariants live
in [the architecture map](kanarek-companion/docs/architecture.md).
