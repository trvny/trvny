# GPTomek

GitHub App used for bot-authored repository operations.

- App ID: `4524407`
- Installation ID: `152126523`
- Runtime module: `../kanarek-companion/src/gptomek.ts`
- Shared Worker: `kanarek-companion`
- Worker secret: `GPTOMEK_PRIVATE_KEY`
- Primary control mailbox: `trvny/trvny#203` (open Issue body)
- Wake relay: GitHub Actions → `POST /gptomek/wake` → shared Worker
- Fallback mailbox: `trvny/trvny#176` (closed PR body)
- Fallback control ref: `gptomek/control` (persistent transport anchor)

## Read this first

The **primary transport is Issue `trvny/trvny#203`**. Commands are hidden in
its body as `<!-- gptomek-command:... -->`. A normal body edit wakes the GitHub
Actions relay, which calls `/gptomek/wake`; the shared Worker executes the
guarded command as `gptomek[bot]` and removes the marker after success.

The old closed PR `trvny/trvny#176` and its `gptomek/control` head ref remain a
**deliberate fallback**, not abandoned debris. Do not delete, merge, rebase,
routinely sync, or repurpose that branch, and do not "clean up" PR #176 while
this README still documents the fallback as active. Retire it only as an
explicit change after the Issue path has a verified replacement and rollback is
no longer wanted.

## Which transport to use

Use Issue #203 for normal GPTomek operations. PR #176 remains the independent
fallback transport. The Issue relay automatically copies the exact command
marker to #176 only when the primary Worker wake fails; successful fallback
handling then clears the primary marker and carries the hidden result back to
Issue #203. The relay verifies that the live Issue still contains that exact
marker before failover and again before result synchronization, so a stale run
does not overwrite a newer command.

Both transports feed the same GPTomek command parser and execution path, so they
have the same operation surface and authorization. The legacy PR does not unlock
extra capabilities.

A same-operation smoke test on 2026-09-08 verified both paths end to end by
adding a `gptomek[bot]` reaction and observing automatic command-marker cleanup.
The Issue path completed in about 3 seconds from mailbox edit to side effect;
the PR path also completed in about 3 seconds.

| Property | Issue #203 | PR #176 |
| --- | --- | --- |
| Supported GPTomek operations | same shared command set | same shared command set |
| Observed smoke latency | ~3 s | ~3 s |
| Wake path | Issue edit → Actions relay → Worker | PR edit → Worker webhook |
| Repository baggage | branchless | requires closed PR + persistent `gptomek/control` ref |
| Best role | maintained default | automatic independent transport fallback |

The PR path has fewer transport hops, so it is useful specifically when GitHub
Actions or the Issue relay is the failing component. That small architectural
advantage is not a reason to use it routinely: the Issue mailbox is clearer,
branchless, and easier to maintain, while measured interactive latency is
effectively the same.

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
connector. End-to-end Issue mailbox smoke tests were verified both before and
after a harmless Desktop Commander call. Treat connector write failures as
their own transient/tooling problem unless evidence shows otherwise.

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
mailboxes are internal transport for GPTomek-only operations; they are not queues
humans should normally edit by hand.

Issue #203 is the maintained primary mailbox. PR #176 remains the fallback
transport. GitHub stops delivering the legacy PR body-edit transport when its
head ref is deleted, so `gptomek/control` must remain present while fallback
support is retained.

The fallback branch is not a working branch and is intentionally not kept current
with `main`. Its tree and distance behind `main` are irrelevant to command
handling; only the ref's continued existence anchors PR #176. GPTomek also
protects the ref from `delete_branch`.

## Command model

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
window. As with any remote API, a connection failure exactly after GitHub accepts
a side effect but before the Worker receives the response is not a mathematically
atomic transaction. Ambiguous outcomes therefore fail closed rather than being
automatically replayed. Prefer the typed idempotent commands for comments/replies
and use `expectedHeadSha` guards for ref-changing operations.

Supported operations:

- `adopt_branch`: rewrite a branch into one GPTomek-authored commit.
- `commit_files`: create one GPTomek-authored file commit.
- `delete_branch`: delete a branch only after checking that its head matches the
  supplied `expectedHeadSha`.
- `comment`: add a PR/issue conversation comment with replay protection.
- `reply_review`: reply to an inline PR review thread with replay protection.
- `react_issue_comment` and `react_review_comment`: add GitHub reactions.
- `operator_action`: perform a generic GitHub REST request through the existing
  GPT Actions bot-write policy. The declared repository must exactly match the
  REST path. Generic issue/label/PR metadata, status, deployment and repository
  dispatch mutations are available for both `trvny/*` and `twojstar/*`.
  Raw contents/ref writes, workflow mutations and release writes stay blocked
  here because the shared runtime routes those families through guarded
  high-level operations instead of a generic REST escape hatch.
- `batch`: run 1–10 commands sequentially against one repository. Each step gets
  a deterministic derived command ID and its own checkpoint. Nested batches are
  rejected. A batch stops on the first error and does not pretend to roll back
  already-completed GitHub side effects; retrying the outer command resumes via
  the per-step deduplication records.

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

## Pet Dispatcher boundary

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
