# GPTomek

GitHub App used for bot-authored repository operations.

- App ID: `4524407`
- Installation ID: `152126523`
- Runtime module: `../kanarek-companion/src/gptomek.ts`
- Shared Worker: `kanarek-companion`
- Worker secret: `GPTOMEK_PRIVATE_KEY`
- Control mailbox: `trvny/trvny#176` (closed PR body; no persistent branch)

The mailbox is intentionally branchless. A hidden command in the closed PR body
is handled through the shared Worker's locked webhook path and removed after a
successful operation.

Supported operations:

- `adopt_branch`: rewrite a branch into one GPTomek-authored commit.
- `commit_files`: create one GPTomek-authored file commit.
- `delete_branch`: delete a branch only after checking that its head matches the
  supplied `expectedHeadSha`.
- `comment`: add a PR/issue conversation comment.
- `reply_review`: reply to an inline PR review thread.
- `react_issue_comment` and `react_review_comment`: add GitHub reactions.

`delete_branch` has layered guards: literal `main` is always protected, the
repository's current `default_branch` is fetched and protected, and the branch
head is checked against `expectedHeadSha` immediately before the DELETE request.
GitHub's delete-ref API has no atomic expected-SHA precondition, so a concurrent
push in the narrow check/delete window remains an unavoidable race. An already
missing target branch is treated as success so mailbox retries stay idempotent.
GitHub also rejects deletion of its current default branch. The App needs
`Contents: write` for ref deletion.

Pull requests remain opened as `trvny` so external automatic review continues
to trigger from the expected author.
