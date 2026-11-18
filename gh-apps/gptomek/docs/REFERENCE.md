# GPTomek reference

Command payloads and exceptional behavior. For the normal workflow, read the
[operator guide](../README.md#quick-operator-guide) first. **Use the relevant
operation below; do not read transport internals for routine writes.**
Implementation truth:
[`gptomek.ts`](../../kanarek-companion/src/gptomek/gptomek.ts).

## Command model

Post the entire `raw-v1` command as a new comment on `trvny/trvny#203`.
Common keys: `id` (unique, 1–100 ASCII letters/digits, `.`, `_`, `-`; no `/`),
`op`, `repository` (`trvny/*` or `travnie/*`). Example ID: `feat-docbench-1`.
Batch `id`: max 90 characters (steps append suffixes). Examples use placeholder
SHAs.

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

One wire format for every operation, including batches:

1. Open the `gptomek` fence. Next line: `raw-v1 <boundary>` (8–64 ASCII
   letters, digits, `_` or `-`). Then the JSON header.
2. Put file contents, patches and comment/reply bodies in raw blocks. Use
   `{"raw":1}` for the first block, `{"raw":2}` for the next, etc. Applies to
   `files[].content`, `patch`, `replyBody`, `comment`/`reply_review` `body`, also
   inside `steps`. Keep `content:null` for deletion and structured metadata
   (including `operator_action.body`) in JSON. Reuse a raw reference for identical
   text across supported slots (e.g. multiple review replies). Every supplied
   block must be referenced at least once.
3. Put `--<boundary>--` on its own line before, between and after blocks.
   Choose a boundary absent from the content as a marker line. With no blocks,
   close the fence directly after the JSON (e.g. `commit_tree`). A single
   redundant marker is tolerated for zero blocks, not missing references.
   Use consistent framing EOL (LF or
   CRLF); preserve the raw text exactly. The EOL immediately before a marker
   is framing, not content: extra blank line for a final EOL or empty block.
4. Close the fence. Send exact source, not rendered Markdown; no escaping,
   trimming or indentation of raw text. `invalid_comment_raw_*`: fix framing,
   header or references; no execution occurred.

## Operation examples

### Commit files

Use for **complete UTF-8 text** contents, including Markdown/docs. `content:
null` deletes a file. Max **32 distinct paths**, **48,000 UTF-16 code units** per
string content. Measure decoded string length, not escaped JSON. Larger files or
large aggregate payloads: create blobs in the target repo, then `commit_tree`.

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
validation, use `commit_files` within its limits, otherwise `commit_tree`.
Never hand-adjust hunk counts to silence a mismatch.

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
  "replyBody": {
    "raw": 2
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
Fixed on the updated head.
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

````text
```gptomek
raw-v1 example123
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
````

### Comments and reactions

For a PR conversation comment use `comment`; for an inline review reply use
`reply_review`; react to **review** vs **issue/PR conversation** comments with
the matching `react_*` operation.

````text
```gptomek
raw-v1 example123
{
  "id": "comment-example-1",
  "op": "comment",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "body": {
    "raw": 1
  }
}
--example123--
Docs updated.
--example123--
```
````

````text
```gptomek
raw-v1 example123
{
  "id": "reply-example-1",
  "op": "reply_review",
  "repository": "trvny/trvny",
  "pullRequestNumber": 123,
  "commentId": 456789,
  "body": {
    "raw": 1
  }
}
--example123--
Fixed.
--example123--
```
````

````text
```gptomek
raw-v1 example123
{
  "id": "react-example-1",
  "op": "react_review_comment",
  "repository": "trvny/trvny",
  "commentId": 456789,
  "reaction": "+1"
}
```
````

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

````text
```gptomek
raw-v1 example123
{
  "id": "batch-example-1",
  "op": "batch",
  "repository": "trvny/trvny",
  "steps": [
    {
      "op": "comment",
      "pullRequestNumber": 123,
      "body": {
        "raw": 1
      }
    },
    {
      "op": "react_review_comment",
      "commentId": 456789,
      "reaction": "+1"
    }
  ]
}
--example123--
Applied.
--example123--
```
````

### Generic allowed write

`operator_action` wraps the shared GPT Actions allowlist for issue/PR metadata,
labels, statuses, deployments and `repository_dispatch`; REST path must match
`repository`. **Not** a raw file/ref editor, PR creator or bypass for secrets,
hooks, rulesets, workflows, releases or sensitive administration.

````text
```gptomek
raw-v1 example123
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
````

## Advanced Git operations

### Revert current HEAD

`commitSha` must equal guarded HEAD and have exactly **one parent**. Creates a
new bot-authored commit with the parent's tree; does not undo arbitrary older
commits.

````text
```gptomek
raw-v1 example123
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
````

### Cherry-pick an existing commit

Source must have exactly **one parent**. For each changed path, target must
match source's parent; unrelated changes remain, conflicting paths fail (no line
merge). Reuses Git objects, including binaries/modes/symlinks/submodules; max
**512 file changes**. File/directory transitions rejected. `message` optional
(defaults to source message).

````text
```gptomek
raw-v1 example123
{
  "id": "pick-example-1",
  "op": "cherry_pick",
  "repository": "trvny/trvny",
  "branch": "feat/target",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
  "commitSha": "89abcdef0123456789abcdef0123456789abcdef"
}
```
````

### Commit existing Git objects

Upload final bytes with GitHub `create_blob` (UTF-8/base64), then send
`commit_tree` with the returned blob SHA per path. Blob upload is not a commit;
GPTomek owns the guarded tree/commit/ref write. Max **512 unique paths**.
New entries require `mode`: `100644` file, `100755` executable,
`120000` symlink, `160000` gitlink. Existing paths may omit mode. Delete with
`sha: null` and **no mode**. Final tree must be free of file/directory
collisions.

````text
```gptomek
raw-v1 example123
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
````

### Move or swap files

`move_files` works on **files**, not directory shorthand. Reuses SHA/mode/type
without downloading; supports swaps/rotations. Unmoved occupied destinations and
namespace collisions fail. Max **256 moves**.

````text
```gptomek
raw-v1 example123
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
````

### Delete a branch

Uses live `expectedHeadSha`; `main`, repo default branch and `gptomek/control`
are protected. Missing target is success. GitHub ref deletion has a narrow
**check/delete race** (not atomic); avoid concurrent writers.

````text
```gptomek
raw-v1 example123
{
  "id": "delete-example-1",
  "op": "delete_branch",
  "repository": "trvny/trvny",
  "branch": "feat/obsolete",
  "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567"
}
```
````

## Troubleshooting

- **👎 on #203:** find bot receipt `GPTomek #<comment ID>` on #203; inspect
  error code and live ref/PR. A transport failure may follow an applied write.
  Retry identical payload only when safe and within retention. For a failed
  batch, inspect completed steps before building a changed command with a new
  ID.
- **`invalid_command_id`:** branch names contain `/`; use a unique ID matching
  `[A-Za-z0-9._-]+` (max 100 chars), not the branch path.
- **`file_content_too_large`:** use `commit_tree` with uploaded blobs, not a
  second oversized `commit_files` command.
- **`command_outcome_uncertain`:** inspect live GitHub state; never
  blind-replay.
- **`review_fix_head_changed` / head conflict:** fetch live SHA, rebuild
  mutation. If `branch_from_patch_branch_exists`, inspect the existing branch
  and contents before switching to an existing-branch operation.
- **Patch errors** (`invalid_patch_hunk_line`, `patch_hunk_count_mismatch`,
  `patch_context_mismatch`, `patch_old_eof_mismatch`): regenerate diff on exact
  base; preserve EOF.
- **`batch_command_id_too_long`:** batch `id` exceeds 90 characters.
- **`invalid_batch_steps`:** split into batches of at most 10 operations.
  Count each reply and reaction as a separate step. No inner `id` or
  `repository`.
- **`gptomek_create_blob:500` / `gptomek_create_tree:500`:** GitHub Git-object
  API fault. Immutable blob/tree POSTs retry 500/502/503/504 twice (250ms,
  750ms); no ref or comment replay. If exhausted, inspect live branch before
  retrying.
- **Successful command, comment still present:** cleanup warning/edited comment;
  check commit first.

Investigate: comment ID → #203 bot error receipt → **live ref/PR/review state** →
Worker logs (`commentId`, `wireFormat`) if available. Actions summaries only for
fallback runs. A posted comment is not evidence of execution.

## Transport internals and recovery

**Normal:** `trvny` posts one fenced `raw-v1` command to
[Issue #203](https://github.com/trvny/trvny/issues/203).
Signed GitHub App webhook enqueues its **comment ID**. Worker independently
fetches/verifies issue, author and payload, then executes under checkpointed
Durable Object locking. One comment per command; no shared command overwritten.
[Actions](../../../.github/workflows/gptomek-comment-command.yml) is manual fallback/rollback.

### Direct webhook

- GPTomek App: configure webhook `https://automation.travny.workers.dev/webhooks/gptomek`; subscribe to Issue comment. Dedicated matching `GPTOMEK_WEBHOOK_SECRET` Worker secret. Never share the secret in comments/chat.
- Default standby: signed ping works; comments do not execute until Worker `GPTOMEK_WEBHOOK_PRIMARY=true` (runtime secret/setting). Set repository Actions variable `GPTOMEK_WEBHOOK_PRIMARY=true` at cutover to skip automatic command jobs. Keep `/gptomek/wake` and manual workflow dispatch `comment_id` for recovery. Rollback: remove both activation flags; keep checkpoint state.
- Signed `issue_comment.created`, exact issue/owner/installation, unedited body digest. Per-comment Durable Object persists job before ACK; alarm executes via existing serialized mailbox lock and checkpoint. Separate cleanup/failure phase. Bounded transport retries, no new Cron Triggers. Failed commands receive a bot error receipt and 👎; uncertain exhausted transport retains source and logs stopped job.
- Missing delivery (no durable receipt): prefer agent issue-body wake below; humans can inspect App delivery, re-deliver or dispatch fallback using original comment ID, after checking live branch. Manual dispatch validates the unedited command and forwards its digest; errors are in the run summary, not a manual-target reaction. GitHub reaction writes have no compare-and-set; never edit a posted command. Existing daily Actions cleanup unchanged in cadence. Do not replay old failed commands automatically.

### Agent recovery: issue #203 wake

- No success/receipt after checking live refs/reviews and allowing webhook retry: use existing issue-body mailbox, **not** a new changed command. Do not wake a known rejection or `command_outcome_uncertain`; inspect/fix first. Only identical parsed command ID and payload within 7-day checkpoint retention; preserve expected SHA and raw blocks' decoded content.
- Read #203 body; if another `<!-- gptomek-command:` marker exists, do not overwrite. Serialize mailbox writes. Preserve existing body/result.
- Decode `raw-v1` to the original complete JSON command (resolve raw references to strings). Encode its UTF-8 JSON as unpadded base64url. Append `<!-- gptomek-command:BASE64URL -->` to #203 body via GitHub issue update as `trvny`. Check encoded body size against GitHub's issue-body limit; do not truncate or split a command. Oversized payload: manual recovery or retry through the comment route; inspect completed steps before rebuilding as `commit_tree` with a new ID. Body edit wakes existing Issues webhook. Toggle `gptomek-wake` label (remove/add based on current state) if needed, only while the same marker remains.
- Read `<!-- gptomek-result:BASE64URL -->` on #203; decode UTF-8 JSON. Confirm matching command ID and live state. Success removes marker. Never overwrite another pending mailbox command; never blindly replay expired or uncertain IDs. Manual Actions/Redeliver for human recovery; #176 last resort only.
- Do not edit the original source comment. The original webhook may still arrive; shared checkpoints prevent duplicate successful commands within retention.

**Results and cleanup:** A successful acknowledged execution gets a second
cleanup wake, which reuses the checkpoint and deletes the unchanged, unedited
source comment. Failure may leave 👎 and a result envelope; daily cleanup removes
qualifying failed, unedited commands and bot error receipts older than **7 days** without executing them. Deterministically stale/permanently invalid failures may discard a marker
earlier. Cleanup has an unavoidable GitHub GET/DELETE race; cleanup warnings do
**not** undo side effects. Result envelope is `<!-- gptomek-result:... -->`;
bot-authored comments/replies carry command markers for replay guards.

**Compatibility/recovery only:** Older fenced JSON comments still decode to
identical commands. Do not choose them for routine writes. Issue-body encoded `<!-- gptomek-command:... -->`
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
