# GPTomek

GitHub App for bot-authored commits, comments, and reactions in `trvny/*`
and `travnie/*`. Runs in the shared Kanarek Companion Worker. PRs are opened
as `trvny` so external reviews trigger.

## Quick operator guide

Post **one fenced `gptomek` JSON command** as a new comment on
[Issue #203](https://github.com/trvny/trvny/issues/203):

````markdown
```gptomek
{
  "id": "example-20261009-1",
  "op": "comment",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "body": "Hello from GPTomek."
}
```
````

- New operation: fresh `id`. Same operation retry: reuse `id` and identical input.
- Branch mutation: read the live head and supply `expectedHeadSha`.
- `batch`: one top-level comment; steps omit `id` and `repository`.
- Successful commands disappear; failed comments remain with 👎.
- Emergency only: [PR #176](https://github.com/trvny/trvny/pull/176).
  Keep both that PR and `gptomek/control` intact.

**[Full manual: command model, JSON examples, internals, and recovery](docs/REFERENCE.md).**
