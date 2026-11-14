# GPTomek reference

Command payloads and exceptional behavior. For the normal workflow, read the
[operator guide](../README.md#quick-operator-guide) first. **Use the relevant
operation below; do not read transport internals for routine writes.**
Implementation truth:
[`gptomek.ts`](../../kanarek-companion/src/gptomek/gptomek.ts).

## Command model

Each command is posted as the **entire body** of a new `trvny/trvny#203`
comment, inside one `gptomek` fenced command (plain JSON or `raw-v1`). Required common keys: `id` (new
unique string), `op`, `repository` (`trvny/*` or `travnie/*`). The examples
below are complete payloads; sample SHAs are **placeholders**, not usable branch
heads.

- Mutating an **existing branch**: specify `branch` + **fresh**
  `expectedHeadSha`. Never trust a previous command response as the next head;
  re-read the ref.
- Creating a **new branch** via `branch_from_patch`: specify `branch` (must not
  exist) + immutable `baseSha`, not `expectedHeadSha`.
- Checkpointing: same `id` + **identical command** safely deduplicates within
  seven-day retention. Same `id` + different input is rejected. After 7 days the
  checkpoint may expire; identical replay can repeat side effects. Check actual
  state first.
- `command_outcome_uncertain`: GitHub may have applied the write without a
  confirmed result. Inspect the actual ref/comment/commit, resolve the
  ambiguity, then choose a **new** command only if warranted. Never blindly
  retry.
- The Worker checkpoints steps and guards ref mutations; no cross-system atomic
  transaction. A failed final ref update is re-read: intended SHA = success, old
  SHA = retryable, other/unknown SHA = uncertain.

## Raw text blocks

Prefer `raw-v1` for multiline file contents, validated patches and long replies.
Keep plain JSON for short commands. Both forms decode to the same command and
use the same validation, authorization, limits and checkpoints. No new endpoint.

- Inside the usual `gptomek` fence, start with `raw-v1 <boundary>` on its own
  line, then the JSON command header. Boundary: 8–64 ASCII letters, digits,
  underscores or hyphens. Choose one absent from the raw text as a marker line.
- Replace a string slot with `{"raw": 1}`; subsequent blocks are numbered from
  1 in physical order. Each must be referenced exactly once. Supported slots:
  `commit_files.files[].content`, `apply_patch.patch`, `branch_from_patch.patch`,
  `review_fix.patch` / `replyBody`, and `comment` / `reply_review` body.
  These slots also work inside `batch.steps`; other fields stay JSON.
- Put `--<boundary>--` on a separate line before the first raw block, between
  blocks and after the last block. Use LF for framing. The framing LF directly
  before each marker is not content: leave an extra blank line to preserve a
  final LF, or one blank line for empty content. Never escape, trim or indent
  the raw text. Keep `content: null` for deletion; ordinary strings still work.
- Send the exact comment source, not rendered Markdown. Embedded backticks are
  preserved by the decoder even when GitHub's preview looks different.
- `invalid_comment_raw_*` or `unused_comment_raw_block`: correct framing or
  references before submitting a new command. No execution on decode failure.

## Operation examples

Plain `json` examples below must be wrapped in the usual `gptomek` fence; raw
examples show the complete comment body.

### Commit files

Use for **complete UTF-8 text** contents, including Markdown/docs. `content:
null` deletes a file. Max **32 distinct paths**, **48,000 characters** per
string content.

````text
```gptomek
raw-v1 example123
{
  "id": "docs-example-1",
  "op": "commit_files",
  "repository": "trvny/trvny",
  "branch": "docs/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "docs: update guide",
  "files": [
    {
      "path": "README.md",
      "content": {
        "raw": 1
      }
    }
  ]
}
--example123--
Complete replacement

--example123--
```
````

### Apply a unified patch

For existing branches and **prevalidated** diffs. Max **32 text files**,
**200,000 patch characters** (transport may limit further). Strict
positional/context matching, no fuzz; preserves LF/CRLF, BOM and existing
executable bits. Supports text create/delete and `100644`/`100755` creation;
**no binary, renames/copies, mode-only changes**.

````text
```gptomek
raw-v1 example123
{
  "id": "patch-example-1",
  "op": "apply_patch",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "fix: change text",
  "patch": {
    "raw": 1
  }
}
--example123--
diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b

--example123--
```
````

Generate the diff with `git diff` and run `git apply --check` on the **exact
guarded tree**. Preserve `\ No newline at end of file` where required; never
invent hunk counts or trailing context. For small or awkward files without local
validation, use `commit_files`.

### Create a branch from a patch

Same patch rules, but target branch must **not exist**. GPTomek creates the
commit before creating the ref. Never use `main`, the repo default branch or
`gptomek/control` as the target.

````text
```gptomek
raw-v1 example123
{
  "id": "new-branch-example-1",
  "op": "branch_from_patch",
  "repository": "trvny/trvny",
  "branch": "feat/new",
  "baseSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "feat: start branch",
  "patch": {
    "raw": 1
  }
}
--example123--
diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b

--example123--
```
````

### Apply a review fix

One guarded patch + review reply + 👍; optionally resolve the thread. PR head
must be an **in-repo** branch matching `branch`; `commentId` must belong to that
PR. Patch rules above apply.

````text
```gptomek
raw-v1 example123
{
  "id": "review-fix-example-1",
  "op": "review_fix",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commentId": 456789,
  "reviewThreadId": "PRRT_example",
  "message": "fix: address review",
  "patch": {
    "raw": 1
  },
  "replyBody": "Fixed on the updated head."
}
--example123--
diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b

--example123--
```
````

`reviewThreadId` and `replyBody` are optional (default reply: `Fixed in
<short-sha>.`). Verify review thread ID before supplying it. Resolution needs
GitHub permission; otherwise the patch/reply/reaction may succeed with
`resolved: false`. Completed substeps are deduplicated for retry.

### Adopt a prepared branch

Replace temporary commits with **one** GPTomek-authored commit using the
branch's final tree and the **merge base** of the PR base branch and live
feature head as `baseSha` (ancestor of the head, not equal to it). Pause other
writers: `expectedHeadSha` is a guard, **not an atomic lock**. Recheck CI after
the rewrite; use **rebase merge** to preserve attribution.

```json
{
  "id": "adopt-example-1",
  "op": "adopt_branch",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "2222222222222222222222222222222222222222",
  "baseSha": "1111111111111111111111111111111111111111",
  "message": "feat: final change"
}
```

### Comments and reactions

For a PR conversation comment use `comment`; for an inline review reply use
`reply_review`; react to **review** vs **issue/PR conversation** comments with
the matching `react_*` operation.

```json
{
  "id": "comment-example-1",
  "op": "comment",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "body": "Docs updated."
}
```

```json
{
  "id": "reply-example-1",
  "op": "reply_review",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "commentId": 456789,
  "body": "Fixed."
}
```

```json
{
  "id": "react-example-1",
  "op": "react_review_comment",
  "repository": "trvny/trvny",
  "commentId": 456789,
  "reaction": "+1"
}
```

Use `react_issue_comment` for top-level issue/PR conversation comments. Allowed
reactions: `+1`, `-1`, `laugh`, `confused`, `heart`, `hooray`, `rocket`, `eyes`.
Useful review feedback deserves 👍 independently of the command mailbox's failure
👎.

### Ordered batch

Same-repository operations, **1–10 sequential** steps. Use `steps`, never
`commands`; steps **omit** `id` and `repository`. Stops on first failure, **no
rollback**. Step checkpoints avoid repeating completed writes on identical
replay. If a later step fails and you need a **new ID/payload**, inspect live
state and omit any steps already applied, especially comments/reactions.

```json
{
  "id": "batch-example-1",
  "op": "batch",
  "repository": "trvny/trvny",
  "steps": [
    {
      "op": "comment",
      "pullRequestNumber": 123,
      "body": "Applied."
    },
    {
      "op": "react_review_comment",
      "commentId": 456789,
      "reaction": "+1"
    }
  ]
}
```

### Generic allowed write

`operator_action` wraps the shared GPT Actions allowlist for issue/PR metadata,
labels, statuses, deployments and `repository_dispatch`; REST path must match
`repository`. **Not** a raw file/ref editor, PR creator or bypass for secrets,
hooks, rulesets, workflows, releases or sensitive administration.

```json
{
  "id": "label-example-1",
  "op": "operator_action",
  "repository": "trvny/trvny",
  "method": "POST",
  "path": "/repos/trvny/trvny/issues/123/labels",
  "body": {
    "labels": [
      "documentation"
    ]
  },
  "expect": "json"
}
```

## Advanced Git operations

### Revert current HEAD

`commitSha` must equal guarded HEAD and have exactly **one parent**. Creates a
new bot-authored commit with the parent's tree; does not undo arbitrary older
commits.

```json
{
  "id": "revert-example-1",
  "op": "revert_commit",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commitSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "revert: bad change"
}
```

### Cherry-pick an existing commit

Source must have exactly **one parent**. For each changed path, target must
match source's parent; unrelated changes remain, conflicting paths fail (no line
merge). Reuses Git objects, including binaries/modes/symlinks/submodules; max
**512 file changes**. File/directory transitions rejected. `message` optional
(defaults to source message).

```json
{
  "id": "pick-example-1",
  "op": "cherry_pick",
  "repository": "trvny/trvny",
  "branch": "feat/target",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commitSha": "89abcdef0123456789abcdef0123456789abcdef"
}
```

### Commit existing Git objects

`commit_tree` uses existing object SHAs (no content upload); max **512 unique
paths**. New entries require `mode`: `100644` file, `100755` executable,
`120000` symlink, `160000` gitlink. Existing paths may omit mode. Delete with
`sha: null` and **no mode**. Final tree must be free of file/directory
collisions.

```json
{
  "id": "tree-example-1",
  "op": "commit_tree",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "chore: assemble tree",
  "entries": [
    {
      "path": "assets/logo.bin",
      "sha": "89abcdef0123456789abcdef0123456789abcdef",
      "mode": "100644"
    },
    {
      "path": "old.txt",
      "sha": null
    }
  ]
}
```

### Move or swap files

`move_files` works on **files**, not directory shorthand. Reuses SHA/mode/type
without downloading; supports swaps/rotations. Unmoved occupied destinations and
namespace collisions fail. Max **256 moves**.

```json
{
  "id": "move-example-1",
  "op": "move_files",
  "repository": "trvny/trvny",
  "branch": "feat/example",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "message": "refactor: move files",
  "moves": [
    {
      "from": "old.bin",
      "to": "new.bin"
    }
  ]
}
```

### Delete a branch

Uses live `expectedHeadSha`; `main`, repo default branch and `gptomek/control`
are protected. Missing target is success. GitHub ref deletion has a narrow
**check/delete race** (not atomic); avoid concurrent writers.

```json
{
  "id": "delete-example-1",
  "op": "delete_branch",
  "repository": "trvny/trvny",
  "branch": "feat/obsolete",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567"
}
```

## Troubleshooting

- **👎 on #203:** inspect workflow/result; fix invalid input or stale state.
  Retry identical payload only when safe and within retention. For a failed
  batch, inspect completed steps before building a changed command with a new
  ID.
- **`command_outcome_uncertain`:** inspect live GitHub state; never
  blind-replay.
- **`review_fix_head_changed` / head conflict:** fetch live SHA, rebuild
  mutation.
- **Patch errors** (`invalid_patch_hunk_line`, `patch_hunk_count_mismatch`,
  `patch_context_mismatch`, `patch_old_eof_mismatch`): regenerate diff on exact
  base; preserve EOF.
- **`invalid_batch_steps`:** `steps` array (1–10), no inner `id` or
  `repository`.
- **`gptomek_create_blob:500` / `gptomek_create_tree:500`:** GitHub Git-object
  API fault; inspect live branch before retrying.
- **Successful command, comment still present:** cleanup warning/edited comment;
  check commit first.

Investigate in order: #203 command → `Run GPTomek JSON comment` Actions →
`/gptomek/wake` response/Worker logs → **live ref/PR/review state**. A posted
comment is not evidence of execution.

## Transport internals and recovery

**Normal:** `trvny` posts one fenced command (JSON or `raw-v1`) to
[Issue #203](https://github.com/trvny/trvny/issues/203).
[Workflow](../../../.github/workflows/gptomek-comment-command.yml) sends its
**comment ID** to authenticated `POST /gptomek/wake`. Worker independently
fetches/verifies issue, author and payload, then executes under checkpointed
Durable Object locking. One comment per command; no shared command overwritten.

**Results and cleanup:** A successful acknowledged execution gets a second
cleanup wake, which reuses the checkpoint and deletes the unchanged, unedited
source comment. Failure may leave 👎 and a result envelope; daily cleanup removes
qualifying failed, unedited commands older than **7 days** without executing
them. Deterministically stale/permanently invalid failures may discard a marker
earlier. Cleanup has an unavoidable GitHub GET/DELETE race; cleanup warnings do
**not** undo side effects. Result envelope is `<!-- gptomek-result:... -->`;
bot-authored comments/replies carry command markers for replay guards.

**Legacy fallback only:** Issue-body encoded `<!-- gptomek-command:... -->`
markers and closed [PR #176](https://github.com/trvny/trvny/pull/176)
still work through the older relay. An unrecorded
primary wake failure may fail over; a recorded command error is **not** a
transport failure. Both routes have the same permissions/checkpoints. **Never
delete, merge, sync, rebase or repurpose #176 or `gptomek/control`.** Its branch
being behind `main` is expected.

## Runtime and components

- GitHub App ID `4524407`; installation `152126523`; author `gptomek[bot]`.
- Shared Cloudflare Worker `automation`, source `gh-apps/kanarek-companion`;
  implementation
  [`src/gptomek/gptomek.ts`](../../kanarek-companion/src/gptomek/gptomek.ts);
  secret `GPTOMEK_PRIVATE_KEY`.
- Checkpoints: existing `OPERATOR_CHECKPOINTS` Durable Object, 7-day retention,
  keyed by command ID and input hash. Branch ref failures are re-read to
  distinguish success, safe retry, uncertainty.
- Worker `fetch` callback must remain bound, e.g. `(input, init) => fetch(input,
  init)`; passing raw `fetch` can throw `Illegal invocation`.
- GPTomek does **not** run local builds, ADB, ffmpeg or arbitrary shell jobs.
  [Devbox](../../../.devcontainer/README.md#gptomek-remote-power-and-diagnostics)
  uses scoped `operator_action`/`repository_dispatch`; machine execution belongs
  outside GPTomek (Pet Dispatcher boundary).
