# GPTomek

GPTomek is the GitHub App identity used when repository automation should be
visibly bot-authored instead of pretending to be `trvny`. Commits, comments,
reactions and routine automation can therefore show up as `gptomek[bot]`,
while pull requests and selected human-authorized state changes stay authored by
`trvny` so the normal external review flow keeps working.

## Start here

For normal GPTomek work:

1. Use Issue [`trvny/trvny#203`](https://github.com/trvny/trvny/issues/203)
   as the control mailbox.
2. Give every new logical command a fresh `id`. Reuse that same ID only when
   replaying the same operation.
3. For branch-changing operations, read the branch head immediately before the
   command and pass it as `expectedHeadSha`.
4. Let the primary Issue path execute the command. Successful bot writes are
   performed by `gptomek[bot]` and the hidden command marker is consumed.
5. Use closed PR [`#176`](https://github.com/trvny/trvny/pull/176) manually
   only when the Issue/Actions relay itself is unavailable. Put exactly one
   command marker in that PR body.
6. Keep the `gptomek/control` ref and PR #176 intact. They are an active
   fallback transport, not historical debris.

The control mailboxes are internal transport. Humans normally do not need to
edit the encoded markers by hand.

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
| Normal bot-authored write | Issue #203 | Default path. The Issue edit wakes the Worker through the guarded Actions relay. |
| Primary wake fails | PR #176 automatically | The mailbox workflow forwards still-live commands through the closed PR one at a time and synchronizes results back to #203. |
| Several commands land in #203 together | PR #176 automatically | The fallback serializes that event snapshot instead of letting one retryable command block later commands. |
| Actions / Issue relay itself is unavailable | PR #176 manually | Put exactly one marker in the closed PR body and reuse the same command ID when replaying the same operation. |

Issue #203 is the maintained default. PR #176 is an independent fallback
transport, not a second queue.

## Quick operator guide

Use Issue #203 as the normal transport. The snippets below show the decoded
command JSON; the transport itself carries the base64url-encoded JSON inside a
`<!-- gptomek-command:... -->` marker.

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

1. Give every new logical command a fresh `id`. Reusing the same `id` with the
   same input is a safe replay; reusing it with different input is rejected.
2. For branch-changing typed operations, read the current head immediately
   before the command and pass it as `expectedHeadSha`.
3. Before a later branch mutation, read the live head again. Do not chain a new
   command from stale PR metadata, a cached branch SHA or a guessed previous
   result.
4. A `batch` step must omit both `id` and `repository`; GPTomek derives the step
   IDs from the outer command and injects the outer repository.

## Who should appear in the edit history?

Seeing different authors on Issue #203 is expected because three identities have
different jobs:

| Visible editor | Why it appears |
| --- | --- |
| `trvny` | The authorized human/connector side writes or wakes a command in the primary mailbox. |
| `gptomek[bot]` | The normal Worker path performs bot-authored GitHub writes and mailbox/result cleanup. |
| `github-actions[bot]` | The Actions fallback copies commands through PR #176 and synchronizes fallback results back to Issue #203 with the workflow token. |

So the usual healthy primary-path pattern is mostly `trvny` ↔
`gptomek[bot]`. A burst of `github-actions[bot]` edits means the fallback
relay was active; it is not the desired author for repository commits or normal
GPTomek comments.

## Technical reference

### Runtime and components

- App ID: `4524407`
- Installation ID: `152126523`
- Runtime module: `../kanarek-companion/src/gptomek.ts`
- Shared Worker: `kanarek-companion`
- Worker secret: `GPTOMEK_PRIVATE_KEY`
- Primary control mailbox: `trvny/trvny#203`
- Wake relay: GitHub Actions → `POST /gptomek/wake` → shared Worker
- Fallback mailbox: `trvny/trvny#176` (closed PR body)
- Fallback control ref: `gptomek/control` (persistent transport anchor)

### Transport internals and recovery

The primary transport is Issue #203. Commands are hidden in its body as
`<!-- gptomek-command:... -->`. A normal body edit wakes the GitHub Actions
relay, which calls `/gptomek/wake`; the shared Worker executes the guarded
command and records the result.

The closed PR #176 and its `gptomek/control` head ref remain a deliberate
fallback. Do not delete, merge, rebase, routinely sync or repurpose that branch,
and do not clean up PR #176 while this README still documents the fallback as
active. Retire it only as an explicit transport change with a verified
replacement and rollback plan.

The Issue mailbox workflow serializes its runs with one concurrency group. If
the primary Worker wake returns an unrecorded failure, the fallback script
checks each marker from the triggering event against the live Issue, forwards it
through #176, waits for a result carrying the same command ID, and updates #203
without overwriting newer mailbox state. A retryable command may remain in #203
with its result marker without blocking later commands from the same event
snapshot.

A command that fails but records a terminal result is not a wake failure: the
wake returns 200 and the relay does not fail over. Only an unrecorded outcome
returns 502. Both transports feed the same guarded GPTomek execution path and
have the same authorization surface. The fallback PR does not unlock extra
capabilities.

Failed commands are retained for retry by default. GPTomek removes a failed
command marker automatically only when the failure proves that replaying the
same command would be stale or permanently invalid: an `adopt_branch` whose
guarded head changed, whose branch disappeared, whose base/head have no changes,
or whose immutable base/head relation is invalid; an `apply_patch` whose
guarded head changed or whose strict patch validation/application failed; a
`revert_commit` whose guarded head changed or target is no longer safely
revertible; a `cherry_pick` whose guarded head changed or whose strict
validation found a conflict or unsupported source change; a `commit_tree` or
`move_files` command whose guarded head changed or whose deterministic tree
validation failed; a `delete_branch` whose guarded head changed; a reused
command ID with different input; or an operation rejected by the bot-write policy. In
particular, `commit_files` head conflicts, API failures, permission problems,
transient 4xx/5xx responses, and uncertain outcomes are not silently discarded.

A same-operation smoke test on 2026-09-08 verified both paths end to end by
adding a `gptomek[bot]` reaction and observing automatic marker cleanup. The
Issue and PR paths both completed in about three seconds in that test. A
multi-command fallback smoke on 2026-10-03 additionally verified that a
retryable command does not block later commands from the same Issue snapshot.

A live mutation smoke on 2026-10-08 verified `apply_patch`, `revert_commit`
and cleanup end to end through Issue #203 on disposable branch
`gptomek-live-test-20261008`. `apply_patch` created bot-authored commit
`8b1c18215bb76c04ad323f6be3810739d918904a` and a real text file;
`revert_commit` created bot-authored commit
`28f51d5ff6e8224d7daea54b37fa53f3fc4a83f4`, restored the parent tree and
removed that file; `delete_branch` then removed the disposable branch. File
and branch lookups both returned 404 after their respective cleanup steps. This
exercise covered the real mailbox wake, Worker authentication, Git data writes,
branch guards, result-marker cleanup and bot attribution rather than only unit
tests or CI.

| Property | Issue #203 | PR #176 |
| --- | --- | --- |
| Supported GPTomek operations | same shared command set | same shared command set |
| Wake path | Issue edit → Actions relay → Worker | PR edit → Worker webhook |
| Repository baggage | branchless | requires closed PR + persistent `gptomek/control` ref |
| Best role | maintained default | independent fallback |

The PR path has fewer transport hops, which is useful when Actions or the Issue
relay is the failing component. That is not a reason to use it routinely: the
Issue mailbox is clearer, branchless and easier to maintain.

When diagnosing the Issue path, check the chain in this order:

1. the edit of Issue #203 and the `gptomek-wake` Actions run;
2. the Worker's `/gptomek/wake` response and Cloudflare logs;
3. the GPTomek command result and automatic marker removal;
4. if the primary wake failed, PR #176 consumption and result sync back to #203.

A known Cloudflare failure mode is passing the runtime `fetch` function around
unbound. Inside Worker/Durable Object paths use a Worker-safe wrapper such as
`(input, init) => fetch(input, init)` rather than defaulting a callback directly
to `fetch`; otherwise Cloudflare can throw `Illegal invocation`.

Do not assume that merely using Desktop Commander disables the GitHub
connector. Treat connector write failures as their own transient/tooling problem
unless evidence shows otherwise.

The fallback branch is not a working branch and is intentionally not kept
current with `main`. Its tree and distance behind `main` are irrelevant to
command handling; only the ref's continued existence anchors PR #176. GPTomek
also protects the ref from `delete_branch`.

### Command model

Every command has a caller-supplied `id`. GPTomek hashes that ID into the
existing `OPERATOR_CHECKPOINTS` Durable Object namespace and hashes the full
command input separately. A completed command can therefore be replayed through
either mailbox without repeating its side effects; reusing one ID for different
input is rejected. Checkpoints use the Operator's existing seven-day retention.

Successful or failed attempts write a hidden `<!-- gptomek-result:... -->`
envelope containing the command ID, operation, repository, transport, duration,
deduplication state and a bounded result or error. Successful commands remove
the command marker. Deterministic failures may retain it for a safe retry. If a
write may have succeeded but its response or checkpoint completion is lost,
GPTomek records `command_outcome_uncertain`, keeps that command ID out of normal
replay and removes the mailbox marker instead of blindly repeating the mutation.
Comments and inline review replies also carry a hidden per-command marker, and
only markers on comments authored by `gptomek[bot]` satisfy the replay guard.

The checkpoint closes the normal duplicate-delivery and cross-transport replay
window. Ref-changing operations add another recovery layer around the final ref
write. If that write reports an error, GPTomek re-reads the guarded branch:
seeing the intended new SHA counts as success; seeing the previous SHA keeps the
attempt safely retryable; seeing any other SHA, or being unable to re-read the
ref, records `command_outcome_uncertain` and fails closed. A recovered guarded
branch mutation that no longer sees its original `expectedHeadSha` is also
treated as uncertain instead of blindly replaying the write.

This still is not a mathematically atomic distributed transaction. Prefer the
typed idempotent commands for comments/replies, use `expectedHeadSha` guards
for ref-changing operations, and re-read live branch state before the next
mutation.

Supported operations:

- `adopt_branch`: rewrite a branch into one GPTomek-authored commit.
- `commit_files`: create one GPTomek-authored file commit.
- `apply_patch`: strictly apply a bounded text-only unified diff against the guarded
  branch head, then create one GPTomek-authored commit. Hunks must match exactly;
  fuzzy matching, binary patches, renames/copies and mode-only changes are rejected.
- `branch_from_patch`: build the strict patch commit against an immutable `baseSha`
  first, then create a previously absent work branch at that commit. Invalid patches
  never leave a half-created branch behind.
- `review_fix`: validate that an inline review comment belongs to the declared PR,
  apply the strict patch through its own checkpoint, reply as GPTomek, add 👍, and
  optionally resolve the supplied review thread. Each side effect has replay protection,
  so a retry resumes rather than reapplying an already committed fix.
- `revert_commit`: restore the first parent's tree as a new GPTomek-authored commit,
  but only when the requested commit is still the guarded branch HEAD. Older commits
  and merge commits are deliberately rejected instead of approximating a three-way revert.
- `cherry_pick`: reapply the file-level tree delta from one single-parent commit
  onto the guarded branch. The target must still match the source commit's parent
  for every affected path; overlapping changes, merge commits and file/directory
  shape changes are rejected instead of being auto-merged.
- `commit_tree`: commit up to 512 file-level Git object mutations against the
  guarded branch without downloading or re-encoding the objects. It supports
  regular files, executables, symlinks, submodule entries, deletions, mode-only
  changes and explicit file/directory shape transitions.
- `move_files`: move up to 256 file-level paths while preserving each source
  object's SHA, mode and Git type. Multi-file swaps and rotations are atomic;
  occupied destinations and unresolved file/directory collisions are rejected.
- `delete_branch`: delete a branch only after checking that its head matches the
  supplied `expectedHeadSha`.
- `comment`: add a PR/issue conversation comment with replay protection.
- `reply_review`: reply to an inline PR review thread with replay protection.
- `react_issue_comment` and `react_review_comment`: add GitHub reactions.
- `operator_action`: perform a generic GitHub REST request through the existing
  GPT Actions bot-write policy. The declared repository must exactly match the
  REST path. Generic issue/label/PR metadata, status, deployment and repository
  dispatch mutations are available for both `trvny/*` and `travnie/*`.
  Raw contents/ref writes, workflow mutations and release writes stay blocked
  here because the shared runtime routes those families through guarded
  high-level operations instead of a generic REST escape hatch.
- `batch`: run 1–10 commands sequentially against one repository. Each step gets
  a deterministic derived command ID and its own checkpoint. Nested batches are
  rejected. A batch stops on the first error and does not pretend to roll back
  already-completed GitHub side effects; retrying the outer command resumes via
  the per-step deduplication records.

### Operation examples

### Commit files

```json
{
  "id": "docs-readme-20260908-1",
  "op": "commit_files",
  "repository": "trvny/trvny",
  "branch": "docs/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "docs: update README",
  "files": [
    {
      "path": "README.md",
      "content": "replacement file contents\n"
    }
  ]
}
```

Set `content` to `null` to delete a file. A command can contain up to 32 unique
paths; individual string contents are limited to 48,000 characters.

### Apply a unified patch

```json
{
  "id": "patch-example-20261008-1",
  "op": "apply_patch",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "fix: adjust example",
  "patch": "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new\n"
}
```

The patch may touch up to 32 text files and is applied only to the exact
`expectedHeadSha`. Every hunk uses strict positional/context matching. GPTomek
preserves untouched per-line LF/CRLF endings, UTF-8 BOMs and existing executable
bits, and honors `100644` / `100755` metadata for newly created files. Empty
text-file creation and deletion are supported. Binary patches, renames/copies,
mode-only changes, unsupported file modes and fuzzy hunk relocation are not.

### Create a branch from a patch

```json
{
  "id": "branch-patch-example-20261008-1",
  "op": "branch_from_patch",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "baseSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "feat: start patched branch",
  "patch": "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new\n"
}
```

`branch_from_patch` uses the same strict text-patch rules as `apply_patch`,
but the target branch must not exist yet. GPTomek validates and applies the
patch against `baseSha`, creates the bot-authored commit, and only then creates
`refs/heads/<branch>`. `main`, the repository default branch and the GPTomek
control ref remain protected. If the final ref creation has an ambiguous network
outcome, GPTomek re-reads the branch before deciding success vs retry vs
`command_outcome_uncertain`.

### Apply a review fix

```json
{
  "id": "review-fix-example-20261008-1",
  "op": "review_fix",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commentId": 456789,
  "reviewThreadId": "PRRT_kwDOExample",
  "message": "fix: address review feedback",
  "patch": "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new\n"
}
```

The PR head must be an in-repository branch matching `branch`, and the review
comment must belong to that PR. The patch, reply and 👍 reaction use derived
checkpoint IDs, so if a later step fails the command can resume without
replaying completed writes. After the patch, GPTomek verifies that the PR head
is exactly the created commit before replying.

`replyBody` is optional; without it GPTomek replies with
`Fixed in <short-sha>.`. `reviewThreadId` is also optional. When supplied,
GPTomek verifies that the thread belongs to the same PR and contains
`commentId`, then resolves it through GitHub GraphQL when the App has
permission to do so. If GitHub reports `viewerCanResolve: false`, the patch,
reply and 👍 reaction still succeed and the result returns `resolved: false`.
Resolution is checked before and after the mutation so an ambiguous response
does not blindly replay the operation.

### Revert the current HEAD commit

```json
{
  "id": "revert-example-20261008-1",
  "op": "revert_commit",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commitSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "revert: bad change"
}
```

`revert_commit` is intentionally conservative: `commitSha` must equal the
current guarded branch HEAD and the target must have exactly one parent. GPTomek
creates a new commit whose tree matches that parent, so no later branch changes
can be silently overwritten.

### Cherry-pick a commit

```json
{
  "id": "cherry-pick-example-20261008-1",
  "op": "cherry_pick",
  "repository": "trvny/trvny",
  "branch": "feat/target",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commitSha": "89abcdef0123456789abcdef0123456789abcdef"
}
```

By default the new GPTomek-authored commit reuses the source commit message.
Supply `message` to override it. The source must have exactly one parent.
GPTomek compares the source commit's parent tree with the source tree, then
requires the guarded target tree to still match that parent for every affected
path. Unrelated target changes are preserved. Conflicting paths are rejected
rather than line-merged.

Because the operation reuses Git object SHAs, it can carry regular files,
executables, symlinks and submodule entries without downloading or re-encoding
their contents. Rename-like changes work as a strict delete plus add when the
destination is free. A single cherry-pick is capped at 512 file-level changes;
directory-descendant checks use a precomputed prefix index rather than rescanning
the repository tree per path. File-to-directory and directory-to-file
transitions are deliberately rejected in this first version.

### Commit existing Git objects

```json
{
  "id": "tree-example-20261008-1",
  "op": "commit_tree",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "chore: assemble tree",
  "entries": [
    {
      "path": "assets/tool.bin",
      "sha": "89abcdef0123456789abcdef0123456789abcdef",
      "mode": "100644"
    },
    {
      "path": "scripts/run.sh",
      "sha": "fedcba9876543210fedcba9876543210fedcba98",
      "mode": "100755"
    },
    {
      "path": "obsolete.txt",
      "sha": null
    }
  ]
}
```

`commit_tree` is the low-level guarded escape hatch for already existing Git
objects. New paths require an explicit mode: `100644` regular file, `100755`
executable, `120000` symlink, or `160000` submodule/gitlink. Existing paths
may omit `mode` to preserve it. A deletion uses `sha: null` and must omit
`mode`. The final file namespace is validated before GitHub receives the tree,
so replacing a file with explicit child paths, or replacing a directory after
explicitly deleting its descendants, is allowed; unresolved file/directory
collisions are not.

The command is capped at 512 unique paths and uses the exact
`expectedHeadSha` as both the base tree source and commit parent. It reuses Git
object SHAs directly, so binary files and large blobs do not pass through the
mailbox payload.

### Move or swap files

```json
{
  "id": "move-example-20261008-1",
  "op": "move_files",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "refactor: move assets",
  "moves": [
    {
      "from": "old/logo.bin",
      "to": "assets/logo.bin"
    },
    {
      "from": "a.txt",
      "to": "b.txt"
    },
    {
      "from": "b.txt",
      "to": "a.txt"
    }
  ]
}
```

`move_files` is file-level: directories are not shorthand move sources. It
reads each source from the guarded tree and reuses its SHA, mode and Git type,
so binary files, executable bits, symlinks and submodules survive unchanged.
All sources are removed before destinations are evaluated, which makes swaps
and rotations possible in one commit. Destinations occupied by files that are
not also being moved away are rejected, as are final file/directory collisions.
A command can contain up to 256 moves.

### Adopt a prepared branch

```json
{
  "id": "adopt-example-20260908-1",
  "op": "adopt_branch",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "baseSha": "1111111111111111111111111111111111111111",
  "expectedHeadSha": "2222222222222222222222222222222222222222",
  "message": "feat: example change"
}
```

Use this after a branch has the desired final tree but temporary commits should
be replaced by one GPTomek-authored commit based on `baseSha`.

### Reply to review

```json
{
  "id": "pr510-review-3960644280-1",
  "op": "reply_review",
  "repository": "trvny/trvny",
  "pullRequestNumber": 510,
  "commentId": 3960644280,
  "body": "Fixed in the final head."
}
```

For a normal PR conversation comment instead, use `op: "comment"`, keep
`pullRequestNumber`, remove `commentId`, and supply `body`.

### React to a review comment

```json
{
  "id": "pr510-review-3960644280-like-1",
  "op": "react_review_comment",
  "repository": "trvny/trvny",
  "commentId": 3960644280,
  "reaction": "+1"
}
```

Use `react_issue_comment` for top-level issue/PR conversation comments. Allowed
reactions are `+1`, `-1`, `laugh`, `confused`, `heart`, `hooray`, `rocket`, and
`eyes`.

### Generic allowed write

Example: add an existing label to PR/Issue #510.

```json
{
  "id": "pr510-label-docs-1",
  "op": "operator_action",
  "repository": "trvny/trvny",
  "method": "POST",
  "path": "/repos/trvny/trvny/issues/510/labels",
  "body": {
    "labels": ["documentation"]
  },
  "expect": "json"
}
```

Use `operator_action` only for the generic surface allowed by the shared GPT
Actions policy. Do not use it as a shortcut for raw contents/ref writes,
workflow mutations, releases, or PR creation; those remain guarded or
human-authored by design.

### Ordered batch

```json
{
  "id": "pr510-followup-1",
  "op": "batch",
  "repository": "trvny/trvny",
  "steps": [
    {
      "op": "comment",
      "pullRequestNumber": 510,
      "body": "Docs follow-up applied."
    },
    {
      "op": "react_review_comment",
      "commentId": 3960644280,
      "reaction": "+1"
    },
    {
      "op": "operator_action",
      "method": "POST",
      "path": "/repos/trvny/trvny/issues/510/labels",
      "body": {
        "labels": ["documentation"]
      },
      "expect": "json"
    }
  ]
}
```

A batch has 1–10 sequential steps, stops at the first error, and does not roll
back earlier GitHub side effects. Completed steps keep their derived checkpoint,
so retrying the same outer command resumes through deduplication instead of
blindly repeating those steps.

### Delete a branch

```json
{
  "id": "delete-example-20260908-1",
  "op": "delete_branch",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "2222222222222222222222222222222222222222"
}
```

Never substitute `main`, the repository default branch, or `gptomek/control`;
GPTomek protects them. Fetch the branch head immediately before deletion and use
that exact SHA as `expectedHeadSha`.

`operator_action` is deliberately an adapter over the existing GPT Actions
allowlist, not a replacement for guarded high-level actions. It still denies
sensitive families such as collaborators, environments, hooks, keys, rulesets,
secrets and variables. Creating a pull request through the bot also remains
denied: PRs are opened as `trvny` so external automatic review continues to
trigger.

`delete_branch` has layered guards: literal `main`, the GPTomek control ref, and
the repository's current `default_branch` are protected, and the branch head is
checked against `expectedHeadSha` immediately before the DELETE request.
GitHub's delete-ref API has no atomic expected-SHA precondition, so a concurrent
push in the narrow check/delete window remains an unavoidable race. An already
missing target branch is treated as success so mailbox retries stay idempotent.
GitHub also rejects deletion of its current default branch. The App needs
`Contents: write` for ref deletion.

### Pet Dispatcher boundary

Machine-level work such as local builds, ADB, ffmpeg or arbitrary workspace
process execution remains outside GPTomek. The intended future bridge is Pet
Dispatcher, but GPTomek does not depend on it until that subsystem is complete
and its capability/session policy is ready for production use.

Future bridge idea: add a narrow GPTomek → Pet Dispatcher adapter for explicitly
allowed machine-scoped jobs, with the Dispatcher owning local execution and
session policy while GPTomek only submits the task and carries the bounded result
back through its normal result envelope. This should be added only after Pet
Dispatcher is production-ready, without turning GPTomek into a general remote
shell.
