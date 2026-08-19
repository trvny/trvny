# GPTomek

GitHub App used for bot-authored repository operations.

- App ID: `4524407`
- Installation ID: `152126523`
- Runtime module: `../kanarek-companion/src/gptomek.ts`
- Shared Worker: `kanarek-companion`
- Worker secret: `GPTOMEK_PRIVATE_KEY`
- Control mailbox: `trvny/trvny#176` (closed PR body)
- Control ref: `gptomek/control` (persistent transport anchor)

## What this is

GPTomek is the bot identity behind repository automation that should not pretend to
be `trvny`. The shared `kanarek-companion` Worker authenticates as the GitHub App
for normal writes and exposes guarded higher-level operations used by automation
and the custom GPT gateway. Operations that deliberately need the human identity,
most notably opening pull requests and selected PR state changes, use the
authorized `trvny` OAuth token instead.

That split is intentional: commits, comments, reactions and routine automation can
be visibly bot-authored, while pull requests stay opened as `trvny` so external
automatic review continues to trigger from the expected author. The control
mailbox below is an internal transport for GPTomek-only operations; it is not a
queue humans should normally edit by hand.

A hidden command in the closed PR body is handled through the shared Worker's
locked webhook path and removed after a successful operation. GitHub stops
delivering that body-edit transport when the PR's head ref is deleted, so
`gptomek/control` must remain present.

The control branch is not a working branch and is intentionally not kept current
with `main`. Its tree and distance behind `main` are irrelevant to command
handling; only the ref's continued existence anchors PR #176. Do not merge,
delete, rebase, or routinely sync it. GPTomek also protects the ref from
`delete_branch`.

Supported operations:

- `adopt_branch`: rewrite a branch into one GPTomek-authored commit.
- `commit_files`: create one GPTomek-authored file commit.
- `delete_branch`: delete a branch only after checking that its head matches the
  supplied `expectedHeadSha`.
- `comment`: add a PR/issue conversation comment.
- `reply_review`: reply to an inline PR review thread.
- `react_issue_comment` and `react_review_comment`: add GitHub reactions.

`delete_branch` has layered guards: literal `main`, the GPTomek control ref, and
the repository's current `default_branch` are protected, and the branch head is
checked against `expectedHeadSha` immediately before the DELETE request.
GitHub's delete-ref API has no atomic expected-SHA precondition, so a concurrent
push in the narrow check/delete window remains an unavoidable race. An already
missing target branch is treated as success so mailbox retries stay idempotent.
GitHub also rejects deletion of its current default branch. The App needs
`Contents: write` for ref deletion.
