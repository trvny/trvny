# GitHub Apps

GitHub App infrastructure for `trvny`.

- [kanarek-companion](kanarek-companion/) is the Cloudflare Worker runtime and
  Kanarek PR companion.
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

The Worker remains named `kanarek-companion` in Cloudflare. Keep private keys
only in Worker secrets.
