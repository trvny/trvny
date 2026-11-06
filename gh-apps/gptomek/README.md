[![ChatGPT](https://custom-icon-badges.demolab.com/badge/ChatGPT-74aa9c?logo=openai&logoColor=white)](#) ![GitHub](https://img.shields.io/badge/-181717?logo=github&logoColor=fff&style=plastic) ![Actions](https://img.shields.io/badge/-2088FF?logo=githubactions&logoColor=fff&style=plastic) [![JSON](https://img.shields.io/badge/JSON-000?logo=json&logoColor=fff)](#)
☀️ Solar-powered coding bot 😎

# GPTomek

GPTomek is the GitHub App identity for bot-authored commits, patches, comments,
review replies and reactions in `trvny/*` and `travnie/*`. **Open PRs as
`trvny`** so external review bots run. The App operates through the shared
Kanarek Companion Worker; it is not a shell.

## Quick operator guide

1. **Read:** inspect the target repo's instructions, default branch, live
   branch/PR state, recent changes and existing PRs. Use GitHub read tools for
   inspection.
2. **Choose:** use the [operation
   examples](docs/REFERENCE.md#operation-examples). Prefer `commit_files` for
   full text replacements. For a new branch without a validated patch, create it
   from the live base ref with GitHub tooling, then commit via GPTomek. Use
   patches only when built and checked against the exact base.
3. **Send:** create a **new comment** on
   [trvny/trvny#203](https://github.com/trvny/trvny/issues/203) as `trvny`. Its
   entire body must be **one** fenced `gptomek` JSON object:

   ````text
   ```gptomek
   {
     "id": "docs-unique-1",
     "op": "commit_files",
     "repository": "trvny/trvny",
     "branch": "docs/example",
     "expectedHeadSha": "0123456789abcdef0123456789abcdef01234567",
     "message": "docs: update example",
     "files": [
       {
         "path": "README.md",
         "content": "Complete new contents\n"
       }
     ]
   }
   ```
   ````

   Replace the example values, especially the SHA, with **live** values. For
   another operation, change the payload using the reference. Do not edit an old
   command comment.
4. **Verify:** posting is **not** execution. Check the Actions run, command
   result and live GitHub state before proceeding. Successful commands normally
   remove their source comment; failures may leave it with 👎. Do not treat
   comment cleanup warnings as failed commits.
5. **Finish:** open/update the PR as `trvny`, address actionable reviews,
   recheck CI on the **final head** and merge only when ready.

## Pick the operation

| Task | `op` |
| --- | --- |
| Replace text | [`commit_files`](docs/REFERENCE.md#commit-files) |
| Strict text diff | [`apply_patch`](docs/REFERENCE.md#apply-a-unified-patch) |
| New branch + diff | [`branch_from_patch`](docs/REFERENCE.md#create-a-branch-from-a-patch) |
| Fix review | [`review_fix`](docs/REFERENCE.md#apply-a-review-fix) |
| One final bot commit | [`adopt_branch`](docs/REFERENCE.md#adopt-a-prepared-branch) |
| Reply/comment/react | [Comments](docs/REFERENCE.md#comments-and-reactions) |
| Ordered steps | [`batch`](docs/REFERENCE.md#ordered-batch) |
| Git operations | [Advanced Git](docs/REFERENCE.md#advanced-git-operations) |
| Allowed metadata | [`operator_action`](docs/REFERENCE.md#generic-allowed-write) |

## Non-negotiable guards

- **One fresh `id` per new command.** Retry the **identical** payload with the
  same ID only while its checkpoint is retained (7 days). Later retries can
  repeat writes: inspect live state. On `command_outcome_uncertain`, never
  blindly replay.
- **Existing branch:** fetch its live head immediately before a write; pass
  `expectedHeadSha`. Fetch it **again** before the next mutation. **New branch
  from patch:** pass immutable `baseSha` instead.
- **Patch:** generate a real `git diff`; run `git apply --check` against that
  exact base. Respect hunk counts, newline/EOF markers and file modes. No
  validated local diff? Use `commit_files` for complete text replacements.
- **Batch:** `steps` (not `commands`), 1–10 steps; omit `id` and `repository`
  inside steps. Sequential, **no rollback** on failure. Before resubmitting with
  a new ID, omit steps already applied.
- **Scope:** `operator_action` cannot bypass guarded Git writes or create PRs.
  Never delete or repurpose [PR #176](https://github.com/trvny/trvny/pull/176)
  or `gptomek/control`.

## Preferred PR merge flow

1. Prepare a feature branch and open its PR as **`trvny`**. Apply review/CI
   fixes via GPTomek.
2. If the final branch contains temporary/non-bot commits, read its live head
   and run `adopt_branch` using the **merge base** of the PR base branch and
   feature head as `baseSha` (an ancestor, not head); use live
   `expectedHeadSha`. Stop other branch writers during adoption: the guard is
   not atomic. Skip if already one correct GPTomek commit.
3. After adoption, **recheck** CI and review threads on the rewritten head. Once
   green and resolved, use **rebase merge**, not GitHub squash merge, to
   preserve the GPTomek commit author.

GPTomek writes commits as `gptomek[bot]` and adds the
`chatgpt-codex-connector[bot]` co-author trailer automatically (without
duplicating existing trailers).

## Reference and recovery

- [Payloads, constraints and errors](docs/REFERENCE.md#operation-examples)
- [Command IDs, replay and uncertain outcomes](docs/REFERENCE.md#command-model)
- [Transport internals](docs/REFERENCE.md#transport-internals-and-recovery)
- [Runtime and components](docs/REFERENCE.md#runtime-and-components)
- [Devbox](../../.devcontainer/README.md#gptomek-remote-power-and-diagnostics)
  uses scoped `operator_action`, **not** remote shell access.

**First failure check:** #203 comment → `Run GPTomek JSON comment` Actions →
Worker `/gptomek/wake` logs → live repo/ref. Never infer success solely from a
posted command or a missing comment.
