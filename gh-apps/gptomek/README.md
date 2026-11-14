[![ChatGPT](https://custom-icon-badges.demolab.com/badge/ChatGPT-74aa9c?logo=openai&logoColor=white)](#) ![GitHub](https://img.shields.io/badge/-181717?logo=github&logoColor=fff&style=plastic) ![Actions](https://img.shields.io/badge/-2088FF?logo=githubactions&logoColor=fff&style=plastic) [![JSON](https://img.shields.io/badge/JSON-000?logo=json&logoColor=fff)](#)  
🌞Solar-powered coding bot😎

# GPTomek

GitHub App for bot-authored commits, patches, comments, review replies and
reactions in `trvny/*` and `travnie/*`. Open PRs as `trvny`. Not a shell.

## Quick operator guide

1. **Read:** repo instructions, live branch/PR, recent changes and open PRs.
2. **Choose:** [operation examples](docs/REFERENCE.md#operation-examples).
   Use `commit_files` for full text; use patches only after `git apply --check`
   on the exact base. Create new branches from the live base before committing.
3. **Send:** one new comment on [#203](https://github.com/trvny/trvny/issues/203)
   as `trvny`. Use `raw-v1` for **every** operation; copy the relevant example.

   ````text
   ```gptomek
   raw-v1 example123
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
         "content": {
           "raw": 1
         }
       }
     ]
   }
   --example123--
   Complete new contents

   --example123--
   ```
   ````

   Replace placeholders with live values. Follow the [framing rules](docs/REFERENCE.md#raw-text-blocks).
   No raw blocks? Close the fence after the JSON header. Never edit old commands.
4. **Verify:** check Actions, command result and live state. Success normally
   deletes the source comment; failure may leave 👎. Posting is not execution.
5. **Finish:** open/update PR as `trvny`; fix valid reviews, resolve threads,
   recheck CI on final head. Rebase merge to preserve GPTomek attribution.

## Guards

- Fresh unique `id` per new command. Identical retry only within 7 days.
  `command_outcome_uncertain`: never blindly replay; inspect live state.
  See [replay rules](docs/REFERENCE.md#command-model).
- Existing branch: fresh `expectedHeadSha` before **each** write. New branch
  from patch: immutable `baseSha`. Batch: `steps`, 1–10, no inner `id` or
  `repository`, no rollback. Omit completed steps before changing a retry.
- [Adopt branch](docs/REFERENCE.md#adopt-a-prepared-branch): after `git`/`gh`
  or non-GPTomek commits, consolidate the pushed final tree into one GPTomek
  commit. Use PR merge base + live `expectedHeadSha`; pause other writers.
  Skip only if already one correct GPTomek commit. Recheck CI and reviews.
- `operator_action` cannot bypass guards or create PRs. Do not touch #176 or
  `gptomek/control` (recovery only).

## Reference and recovery

- [Operations, framing, constraints](docs/REFERENCE.md#operation-examples)
- [Troubleshooting](docs/REFERENCE.md#troubleshooting)
- [Transport internals](docs/REFERENCE.md#transport-internals-and-recovery)
- [Devbox](../../.devcontainer/README.md#gptomek-remote-power-and-diagnostics):
  scoped dispatch, not shell access.

Failure check: #203 → `Run GPTomek JSON comment` Actions → `/gptomek/wake`
logs → live repo/ref. GPTomek adds the Codex co-author trailer automatically.
