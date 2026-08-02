---
name: github-ops
description: Operate safely on GitHub repositories using the available authenticated connector or an authenticated gh CLI. Use for repository writes, multi-file commits, pull requests, reviews, Actions debugging, releases, or merge decisions. Discover current tool capabilities instead of relying on memorized connector function names.
---

# GitHub operations

GitHub integrations evolve. Treat tool names in old notes as examples, not an
API contract. First inspect the tools available in the current environment and
choose the path that can actually complete and verify the task.

## Choose an execution path

Prefer an authenticated GitHub connector when it can read or write the target
repository. It avoids local token handling and usually provides structured
operations for files, commits, branches, pull requests, reviews, and Actions.

Use `gh` only when it is already authenticated and the connector lacks a needed
operation. Check with `gh auth status`; the presence of the binary is not proof
of authentication. Never ask the user to paste a token into chat and never use
an unauthenticated API request as the source of truth for private or
rate-sensitive work.

If neither path can perform the requested write, report that limitation. Do not
invent a successful commit, review, dispatch, deployment, or merge.

## Before writing

1. Read the repository's local `AGENTS.md` and nearer instructions.
2. Check the default branch, open pull requests, and recent changes when work
   may overlap.
3. Read every file being changed and capture the current blob or head SHA when
   the available write operation requires it.
4. Decide whether the change is truly trivial enough for the default branch or
   belongs on a branch and pull request.
5. Preserve unrelated work and match the repository's existing commit style.

## Commit semantics

- Prefer one atomic commit when several files form one logical change and the
  available tools support tree or multi-file writes.
- When only per-file writes are available, use a branch, keep the sequence
  coherent, and verify the final combined diff before opening or merging a PR.
- Re-read current state before updating a file after concurrent activity.
- Never force a branch update merely to hide a conflict. Rebase or merge only
  when the repository policy and task call for it.
- A returned HTTP success is not enough. Record the observed commit SHA and
  compare or re-read the result.

## Pull requests and review

Keep the PR description brief and factual: outcome, important constraints, and
validation. Do not restate the whole repository contract.

Treat automated review as advisory. In `trvny/*`, Codex may comment and advise;
do not ask it to implement, commit, push, update the branch, or resolve
conflicts. Apply valid findings directly.

Before merging, inspect as many of these as the current tools expose:

- final head SHA and complete diff,
- required checks and their conclusions on that SHA,
- submitted reviews and review decision,
- unresolved inline review threads,
- mergeability or conflicts,
- repository rules or protection failures.

No single field such as `mergeable`, `CLEAN`, or a green summary proves the
whole gate. If a required part cannot be inspected, say so rather than claiming
it passed. Prefer squash merge unless the repository says otherwise.

## Actions and deployments

- Confirm that the changed paths actually trigger the expected workflow.
- Distinguish a workflow that never started, a queued or platform-side delay,
  and a job whose code failed.
- Read the failing job and step logs before editing code.
- Re-run only the failed scope when that is sufficient and authorized.
- A successful push does not prove a deployment succeeded. Observe the relevant
  run, artifact, environment, or endpoint before reporting deployment success.
- Do not create a workflow whose only purpose is to push a commit that triggers
  another workflow when a normal authenticated commit can do the job.

## External and destructive operations

Creating releases, changing secrets, deleting branches or resources, enabling
workflows, deploying, and merging are external side effects. Perform them only
when explicitly requested and authorized. Use least-privilege credentials and
never print secret values.

## Completion report

Report briefly:

- repository and branch,
- commit SHA or PR number,
- changed files,
- validation and CI observed,
- unresolved review or platform limitations.
