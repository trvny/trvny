# GitHub Apps

GitHub App infrastructure for `trvny`.

- [kanarek-companion](kanarek-companion/) is the Cloudflare Worker runtime and
  Kanarek PR companion.
- [GPTomek](gptomek/) is the coding bot identity and reuses the same Worker for
  installation authentication and GitHub API operations.

The Worker remains named `kanarek-companion` in Cloudflare. Keep private keys
only in Worker secrets.
