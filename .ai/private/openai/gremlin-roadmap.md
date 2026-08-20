# Gremlin / GPTomek checkpoint

Private roadmap for the Custom GPT operator stack. This belongs in the private
overlay in `trvny/trvny`, not the public `trvny/.ai` template.

## Current state

The gateway is already usable as a guarded GitHub operator rather than a bag of
raw REST calls.

- OAuth bridge verifies the authorized user as `trvny`; ordinary bot-authored
  writes use `gptomek[bot]`.
- Guarded file commits, branch creation/deletion/cleanup, PR creation/state,
  review-thread state, comments/reactions/labels and issue triage.
- Repository context, PR inspection/finalization and workflow diagnosis.
- Workflow rerun/cancel plus validated `workflow_dispatch`.
- Guarded release create/update plus Actions-artifact -> release-asset upload
  and exact-snapshot asset deletion.
- `orchestrateRelease` adds a resumable guarded release state machine: validate
  policy/target -> checkpoint dispatch baseline -> dispatch/identify exact bot
  workflow run -> wait/diagnose -> select exact artifact -> create/update
  release -> upload asset -> verify release/asset/latest state. It pauses between
  mutation stages so retries resume from Durable Object progress rather than
  blindly replaying uncertain writes.
- `prepareChange` for base/head/AGENTS/issue-aware change setup.
- `investigateCode` with path/language/ref filters and optional file history.
- Per-repository maintenance report plus exact artifact/cache cleanup.
- Account-wide maintenance radar across active owned repositories.
- `runAccountMaintenanceAutofix` can plan and execute bounded safe maintenance:
  current-head first-attempt workflow retries, exact closed-PR branch cleanup,
  dead-branch cache cleanup and expired-artifact deletion through existing
  guarded actions.
- Maintenance cache pressure is policy-driven. The private policy defines global
  cache size/age thresholds and optional per-repository overrides. Account scans
  surface `cache_pressure`; autofix may remove stale caches only while the repo is
  over its size threshold, and rechecks pressure plus `lastAccessedAt` immediately
  before deletion.
- `runOperatorAutopilot` composes the operator loop: policy-scoped account scan,
  safe maintenance plan/execution, verification scan, bounded PR inspection and
  a prioritized continuation queue for model-driven follow-through.
- Autopilot operations can use stable `operationId` checkpoints in a dedicated
  Durable Object. Completed results replay safely; a lost/expired running lease
  recovers with a forced read-only verification pass instead of replaying
  uncertain mutations. The same store now supports bounded paused progress for
  multi-call release orchestration. OAuth bearer tokens are never stored there.
- `diagnoseWorkflowRun` keeps failure-signal windows plus the log tail for up to
  three failing jobs, avoiding setup-heavy first-chunk excerpts while preserving
  the existing run/job/failed-step summary.
- Private operator policy lives in `.ai/private/openai/gremlin-policy.json` and
  `getOperatorBootstrap` returns its validated model/runtime contract plus
  optional repository metadata and root `AGENTS.md` guidance.
- Account maintenance and maintenance autofix are policy-wrapped: repository
  include/exclude rules, archived handling, run limits, autofix enablement,
  workflow retry budget and cache thresholds are enforced before guarded
  mutations execute.
- PR finalization and release mutations are policy-wrapped too. Merge enablement
  and method, repository scope, archived handling and release branch ancestry
  are checked before the existing expected-SHA, CI, review and snapshot guards.
- Generic raw branch/workflow/release writes are blocked in favor of guarded
  actions.
- Operator plumbing caches OAuth `/user` checks and GPTomek installation tokens;
  `githubReadBatch` can perform up to 10 allowlisted reads concurrently.
- GPTomek control mailbox remains a separate internal transport and
  `gptomek/control` stays a persistent anchor.

## Next: private `.ai` control plane

- [x] Add `.ai/private/openai/gremlin-policy.json` as the private
  runtime/operator policy source of truth. JSON is intentional here: strict
  parsing and zero extra Worker dependency. Keep the public `.ai` repository a
  reusable template.
- [x] Split that policy into model guidance and deterministic runtime guards:
  autonomy, repository scope, stop conditions, maintenance limits and
  merge/release rules.
- [x] Validate the private policy strictly so unknown keys, malformed values or
  unsafe limits fail closed instead of silently changing behavior.
- [x] Add `getOperatorBootstrap`, returning effective private policy, optional
  repository metadata/root `AGENTS.md`, capability categories and stop
  conditions in one compact response.
- [x] Teach the current mutation-heavy high-level actions to consume the same
  policy automatically where deterministic enforcement belongs.
  - [x] Account maintenance and maintenance autofix policy enforcement.
  - [x] Merge/finalize and release policy enforcement.
- [ ] Keep the Custom GPT instruction block small: personality + broad operating
  contract + “follow runtime operator policy”. Do not duplicate the policy into
  the 8k instruction field.
- [ ] Optionally generate a compact Builder/Knowledge pack from the private
  overlay so personality/reference material has a maintained source rather than
  hand-copied text.

## Autopilot

- [x] Build the guarded account/repository operator loop:
  scan -> classify -> plan -> execute safe steps -> verify -> report/continue.
  `runOperatorAutopilot` performs the deterministic cycle and returns prioritized
  continuation tasks so the model can keep working without routine human input.
- [x] Start with maintenance: the account radar selects repositories and
  `runAccountMaintenanceAutofix` uses detailed repo reports only where needed.
- [x] Auto-handle the first deterministic safe chores through guarded actions:
  exact expired artifacts, dead-branch caches, closed-PR orphan branches with
  expected SHA and one reasonable current-head workflow retry.
- [x] Move maintenance repository scope, per-run limits, autofix enablement and
  workflow retry budget into the private runtime policy.
- [x] Add policy-driven cache/age thresholds and per-repository maintenance
  exceptions. Defaults are 5 GiB active cache pressure and 5 days since last
  access; per-repository overrides may tune both or disable autofix. Stale cache
  deletion revalidates the current snapshot before mutation.
- [x] Keep product/code decisions in the model. Runtime decides what is allowed;
  the autopilot queues semantic follow-through instead of inventing code fixes in
  the Worker.
- [x] Add resumable operation/checkpoint IDs for long or interrupted runs. A
  stable client-supplied `operationId` gets a strongly consistent Durable Object
  checkpoint, bounded lease, safe result replay and read-only recovery after an
  uncertain interruption.
- [x] Add end-to-end release orchestration: validate target -> dispatch build ->
  wait/diagnose -> collect exact artifact -> create/update release -> attach
  asset -> verify release/asset/latest state. Dispatch and upload recovery are
  checkpoint-aware so an interrupted request does not blindly replay mutations.

## High-value follow-ups

- [ ] Nested `AGENTS.md` support for target directories, not only root guidance,
  in context/prepare/investigation flows.
- [x] Improve workflow diagnosis to return failure-focused/tail log excerpts
  instead of primarily the first chunk of logs.
- [ ] Paginate PR review threads beyond the current first 100 when needed.
- [ ] Request-local memoization for identical GitHub GETs inside one high-level
  action, beyond the existing OAuth/install-token caches.
- [ ] Make conflict responses more self-describing (`expected`, `current`,
  changed resource metadata) so the model can recover without an extra read.
- [ ] Keep shrinking/tooling the OpenAPI surface: prefer high-level guarded
  workflows, use generic read/bot calls only as escape hatches, and consider a
  central action registry if router boilerplate keeps growing.
- [ ] Add a compact capability/version manifest so the GPT can tell which
  gateway generation is deployed before choosing a workflow.
- [ ] Add a harmless post-deploy smoke/E2E check for the live Worker. Do not
  infer successful deployment merely from a merge to `main`.

## Optional/luxury

- [ ] Release assets v2: select/extract a specific APK/AAB/checksum from an
  Actions artifact instead of publishing the whole artifact ZIP.
- [ ] Safe replace-release-asset workflow composed from exact delete + fresh
  snapshot + upload.
- [x] Account maintenance filters/priorities driven by private policy: repository
  scope, cache size/age thresholds and repository-specific exceptions now affect
  both attention ranking and safe cache cleanup.
- [ ] Account-level PR/issue sweep for “what needs my attention?” beyond pure
  Actions/cache maintenance.
- [ ] More code-investigation ergonomics only when they remove real round trips
  (symbol/history/blame-oriented context), rather than wrapping every GitHub
  endpoint.

## Design constraints

- One source of truth per concern.
- Public `.ai` stays reusable; personal/operator policy stays in the private
  overlay in `trvny/trvny`.
- Guarded high-level actions are preferred over raw mutation endpoints.
- GPTomek performs normal bot-authored writes; intentionally human-authored
  operations stay `trvny`.
- Codex review is advisory. The active operator evaluates findings and performs
  writes itself.
- Never persist OAuth bearer tokens in operator checkpoints. Recovery requires a
  fresh authorized Action call.
- Policy may narrow or disable behavior, but it never weakens hard safety floors
  such as expected-SHA/snapshot guards, green relevant CI or review-state checks.
