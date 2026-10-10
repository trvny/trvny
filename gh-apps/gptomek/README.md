# GPTomek

GPTomek is the GitHub App identity for bot-authored commits, comments and
reactions in `trvny/*` and `travnie/*`. Pull requests are opened as
`trvny` to trigger external reviews. The runtime runs in the shared
Kanarek Companion Worker.

## Quick operator guide

Use a new comment on [Issue #203](https://github.com/trvny/trvny/issues/203) as the normal operator transport. The whole comment
must be one fenced `gptomek` block, for example:

````markdown
```gptomek
{
  "id": "example-20261008-1",
  "op": "comment",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "body": "Hello from GPTomek."
}
```
````

The workflow sends only the numeric comment ID to the Worker's authenticated
`/gptomek/wake` endpoint. The Worker then fetches that comment using the
GPTomek App installation, verifies that it belongs to Issue #203 and was
authored by `trvny`, parses the fenced JSON, and feeds it into the same command
parser and checkpointed executor as the legacy transport. Concurrent comment
commands are serialized by the existing Durable Object lock, so GitHub Actions
concurrency is not used as a lossy queue.

| Goal | Operation |
| --- | --- |
| Commit one or more files on an existing branch | `commit_files` |
| Apply a strict unified diff and commit the result | `apply_patch` |
| Create a new branch from a base commit plus a strict patch | `branch_from_patch` |
| Apply a review fix, reply, react and optionally resolve the thread | `review_fix` |
| Revert the current HEAD commit without local git | `revert_commit` |
| Reapply one strict single-parent commit onto a guarded branch | `cherry_pick` |
| Commit existing Git object SHAs as a guarded tree mutation | `commit_tree` |
| Move or swap files without copying their contents | `move_files` |
| Collapse a prepared branch into one GPTomek-authored commit | `adopt_branch` |
| Remove a known branch safely | `delete_branch` |
| Add a PR/issue conversation comment | `comment` |
| Reply to an inline review comment | `reply_review` |
| React to an issue/PR comment or review comment | `react_issue_comment` / `react_review_comment` |
| Generic allowed GitHub metadata/status/deployment write | `operator_action` |
| Run several same-repository operations in order | `batch` |

Four rules prevent most foot-guns:

1. Give each new command a fresh `id`. For a retryable outcome, replay the
   identical input with that `id`. If the outcome is `command_outcome_uncertain`,
   inspect live state and resolve it first; do not blindly retry.
2. For changes to an existing branch, fetch the live head and supply
   `expectedHeadSha`. `branch_from_patch` instead creates a new branch from
   the immutable `baseSha` and has no `expectedHeadSha`.
3. Before a later branch mutation, read the live head again. Do not chain a new
   command from stale PR metadata, a cached branch SHA or a guessed previous
   result.
4. A `batch` step must omit both `id` and `repository`; GPTomek derives the step
   IDs from the outer command and injects the outer repository.

## Preferred PR merge flow

When bot-authored work should land on `main` as one GPTomek-authored commit
while the pull request itself stays authored by `trvny`, use this flow:

1. Prepare the feature branch and open the pull request as `trvny` so the
   normal external review automation triggers.
2. Apply review findings and CI fixes on that branch until the intended tree is
   final.
3. After reading the current branch head, run `adopt_branch` with the PR base
   as `baseSha` and the live branch head as `expectedHeadSha`. This rewrites
   the branch to one commit authored by `gptomek[bot]`.
4. Treat the rewritten commit as the final head: re-check relevant CI and review
   state because changing the commit SHA can trigger a fresh validation cycle.
5. Once the final GPTomek-authored head is green and actionable review threads
   are resolved, merge the PR with **rebase merge**, not GitHub's squash merge.
   The branch is already a single commit, so rebase merge places that commit on
   `main` while preserving GPTomek as its author.
6. If the branch already consists of the desired single GPTomek-authored commit,
   skip `adopt_branch` and use the same final-head checks plus rebase merge.

## Which mailbox to use

| Situation | Transport | What happens |
| --- | --- | --- |
| Normal bot-authored write | JSON comment on Issue #203 | Preferred path. Actions forwards the comment ID; the Worker fetches, validates and executes the JSON directly through the shared Durable Object lock. |
| Existing encoded Issue-body marker | Issue #203 | Legacy compatibility path. Its existing Actions relay and automatic PR #176 failover remain intact. |
| Legacy Issue wake fails | PR #176 automatically | The legacy mailbox workflow forwards its still-live encoded command through the closed PR and synchronizes the result back to #203. |
| Direct comment/Worker path is unavailable | PR #176 manually | Emergency path. Put exactly one legacy marker in the closed PR body and reuse the same command ID when replaying the same operation. |

Issue #203 is the maintained default. PR #176 is an independent fallback
transport, not a second queue.

## Status and troubleshooting

- Confirmed successful commands normally have their Issue #203 comment deleted.
  Duplicate deliveries, edited comments or cleanup failures may leave completed
  commands visible. Check the actual result before retrying; failed commands
  remain with 👎. Keep the same ID and input for safe retries, but investigate
  `command_outcome_uncertain` rather than replaying it.
- For a failed command, check the comment workflow, the Worker's
  `/gptomek/wake` response and logs, then the repository's live state.
- Strict `apply_patch` and `review_fix` hunks must match the actual base,
  including EOF newline markers. Prefer `git diff` and `git apply --check`;
  `commit_files` is simpler for full text-file replacement.
- The legacy closed [PR #176](https://github.com/trvny/trvny/pull/176)
  and `gptomek/control` ref are an active fallback. **Never delete or reuse them.**

## Detailed reference

- [Command model: replay, checkpoints and recovery](docs/REFERENCE.md#command-model)
- [JSON operation examples and limits](docs/REFERENCE.md#operation-examples)
- [Transport internals, fallback and diagnostics](docs/REFERENCE.md#transport-internals-and-recovery)
- [Runtime and components](docs/REFERENCE.md#runtime-and-components)

The [reference](docs/REFERENCE.md) owns the detailed protocol and implementation
semantics. This README is the day-to-day operator guide.
