# AGENTS.md

> na spokojnie

Prefer improving an existing home over creating another parallel structure.

## GitHub

- When available, use `gptomek[bot]` for commits, comments, review replies, and
  reactions, but open pull requests as `trvny` so automatic reviews run. Prefer
  the existing GPTomek path over new command-only Actions or Workers.
- GPTomek uses closed PR `trvny/trvny#176` as its command mailbox. Its
  `gptomek/control` head ref is a transport anchor only and must remain present.
  Do not merge, delete, or sync that branch with `main`; its contents and how far
  it trails `main` are intentionally irrelevant.
- Prefer one logical change per pull request; truly trivial, low-risk fixes can
  go directly to `main`.
- Keep pull-request descriptions, comments, and changelogs brief. Treat automatic
  Codex review as advisory and apply useful findings directly.
