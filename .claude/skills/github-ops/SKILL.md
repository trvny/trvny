---
name: github-ops
description: Operate on any GitHub repo correctly via github:* tools or the gh CLI — picking the right path, read/write with correct commit semantics, opening/reviewing PRs, dispatching and debugging Actions, cutting releases. Use whenever a task touches GitHub beyond a one-line read, or you reach for github:*/gh. Covers the pre-merge gate (review-thread resolution, rulesets, CI annotations, signed-commit/rebase merges, force-with-lease recovery) — use before merging any PR or when a merge is BLOCKED with everything apparently green.
---

# GitHub Ops

Two ways to act on a repo. Pick deliberately — they have different auth, different strengths, and different failure modes.

- **MCP `github:*` tools** — authenticated through the connector, structured JSON in/out, no shell or token needed. **Default** for reading files, committing, PRs, issues, search, releases.
- **`gh` CLI** — needs a token (`gh auth login`, or `GH_TOKEN`/`GITHUB_TOKEN`; CI provides the latter). With the `/x/all` connector toolset (the default here, ~90 tools) MCP now covers most Actions work too — see below. Reach for `gh` only for what MCP still can't do: **setting secrets (`gh secret set`), creating a release with notes, live `run watch` streaming, and shell piping / `-q` jq**.

Hard rule learned the hard way: **never hit `api.github.com` unauthenticated** (plain `curl`, or `gh` with no token). It's rate-limited to ~60/hr per IP and datacenter/CI IPs are usually already exhausted — you get a `{"message": "API rate limit exceeded…"}` dict, not data. Route through the connector (authed) or an authed `gh`.

## Which path

| Task | Path |
|---|---|
| Read a file / list a dir / get a commit | MCP `get_file_contents` / `list_commits` |
| Commit one file | MCP `create_or_update_file` |
| Commit several files together (atomic) | MCP `push_files` |
| Open / update / merge a PR; review | MCP `create_pull_request` / `pull_request_*` |
| Search code / repos / issues / PRs | MCP `search_*` |
| **Read Actions run logs** | MCP `get_job_logs` (or `gh run view --log` for live tail) |
| List / inspect workflow runs | MCP `actions_list` / `actions_get` |
| **Trigger a workflow** | MCP `actions_run_trigger` (or `gh workflow run`) |
| **Set a secret** | `gh secret set NAME -R owner/repo` (no MCP write) |
| **Cut a release with notes** | `gh release create` (MCP `list_releases`/`get_latest_release` are read-only) |
| Anything needing a pipe / `-q` jq / scripting | `gh` |

In a sandbox where the connector is authed but no token is reachable (common here), **prefer MCP for everything it covers** — including Actions logs and dispatch — and only reach for `gh` when the task is genuinely in its shrunken column (secrets, release notes, live `run watch`, piping); then check whether a token actually exists first.

## MCP path: commit semantics

The one rule that bites: **`create_or_update_file` requires the current blob SHA when updating an existing file.** Omit it and the write 409/422s. Get the SHA from `get_file_contents` (it returns one) or `git rev-parse <branch>:<path>`. Creating a *new* file needs no SHA.

**Prefer `push_files` whenever more than one file changes together** — it lands them in a single atomic commit and needs no SHA. This is the right tool for lockstep edits (two files that must agree, e.g. a config mirrored across a worker and a generator): one commit, no half-applied state, no SHA juggling.

Other MCP tools: `create_branch`, `delete_file`, `merge_pull_request`, `pull_request_review_write` (+ `add_comment_to_pending_review` for inline comments), `get_latest_release`/`list_releases`. `search_code` is repo-wide and fast; reach for it before cloning to grep.

## gh path: auth and install

- **Auth check first:** `gh auth status`. If unauthenticated, either `gh auth login` (interactive) or `export GH_TOKEN=…`. Never ask the user to paste a token into a chat transcript — point them at `gh auth login` or the CI `GITHUB_TOKEN`.
- **Install without apt** (download the release binary; avoids the rate-limited API for version lookup by reading the `releases/latest` redirect):
  ```bash
  tag=$(curl -sI https://github.com/cli/cli/releases/latest | grep -i '^location:' | grep -o 'tag/v[0-9.]*' | sed 's#tag/v##' | tr -d '\r')
  curl -sL "https://github.com/cli/cli/releases/download/v${tag}/gh_${tag}_linux_amd64.tar.gz" -o /tmp/gh.tgz
  tar -xzf /tmp/gh.tgz -C /tmp && cp /tmp/gh_${tag}_linux_amd64/bin/gh /usr/local/bin/gh && gh --version
  ```
- **Actions debugging.** MCP `get_job_logs` pulls job logs without a token — use it first. `gh` still wins for a *live* tail: `gh run watch <id>`, `gh run view <id> --log-failed`. List via MCP `actions_list` or `gh run list -R owner/repo`. Distinguish a *code* failure (a step errored) from a *GitHub-side* delay/skip (scheduled runs get throttled on low-activity repos — the run simply never started; the fix is `actions_run_trigger`/`gh workflow run`, not a code change).

## Commit & PR conventions

- **Match the repo's existing style.** Before composing a message, glance at recent history (`list_commits`) and mirror it: prefix style (`chore:`, `fix:`, `feat:`), tense, scope. Don't impose conventional-commits on a repo that doesn't use them, and do follow it on one that does.
- **Atomic commits.** One logical change per commit; files that must move together go in one `push_files` call.
- **Direct-to-`main` vs PR.** Small fix on a solo/low-stakes repo → committing straight to `main` is fine. Larger, risky, or collaborative → `create_branch` + `create_pull_request`. If a push to a protected branch is rejected, fall back to branch + PR rather than forcing it.
- **Scan before you push.** Run `run_secret_scanning` on file content you're about to commit — catch a leaked key before it's in history, not after.

## Verify after writing

A write isn't done when the tool returns 200 — it's done when you've confirmed the effect:

1. **Commit landed** — use the returned commit SHA, or re-read with `get_file_contents`.
2. **Triggered workflows actually pass.** If the changed path matches a workflow trigger (e.g. a deploy on `worker/**`, an hourly build), watch it: `gh run watch` if `gh` is authed, else poll MCP `get_job_logs`/`actions_list` or check `list_commits` for the bot's follow-up commit. Don't assume a push that compiles locally also deployed.
3. **Report the SHA / PR URL / run conclusion**, not just "done."

## Merging a PR

Don't just call `merge_pull_request`/`gh pr merge`. Run the gate first: threads resolved, `reviewDecision APPROVED`, `mergeStateStatus CLEAN`, every check green, no CI annotations, rulesets satisfied, commits signed if required. The trap that bites: `gh pr view` exits 0 regardless of what it reports, and `CLEAN` does **not** imply threads are resolved — so query the gate, *read* it, then merge as a separate command; never `gate && merge`. A `BLOCKED` with empty `reviewDecision` and all checks green is usually a repository **ruleset** (invisible to `gh pr view` and classic branch protection). Connector-only chat can't verify threads/rulesets — say so rather than claiming a gate you couldn't run. Full recipes, signed-rebase ff-only merge, and `--force-with-lease` "stale info" recovery: `references/pr-merge-gate.md`.

## Gotchas

- **Unauth `api.github.com` is rate-limited** from cloud IPs → use the connector or authed `gh`. (Web/`raw.githubusercontent.com` fetches are fine; it's the *API* host that bites.)
- **`create_or_update_file` update without SHA fails** — fetch the SHA first, or use `push_files`.
- **`push_files` is last-write-wins** — re-read if a concurrent change may have landed since you fetched.
- **`gh` exists ≠ `gh` is authed.** Always `gh auth status` before relying on it; a fresh install reaches the request and stops at auth.
- **Don't paste tokens into the conversation.** Auth happens in the user's environment, not the transcript.
