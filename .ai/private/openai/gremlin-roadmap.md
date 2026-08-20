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
- `prepareChange` for base/head/AGENTS/issue-aware change setup.
- `investigateCode` with path/language/ref filters and optional file history.
- Per-repository maintenance report plus exact artifact/cache cleanup.
- Account-wide maintenance radar across active owned repositories.
- Generic raw branch/workflow/release writes are blocked in favor of guarded
  actions.
- Operator plumbing caches OAuth `/user` checks and GPTomek installation tokens;
  `githubReadBatch` can perform up to 10 allowlisted reads concurrently.
- GPTomek control mailbox remains a separate internal transport and
  `gptomek/control` stays a persistent anchor.

## Next: private `.ai` control plane

- [ ] Add `.ai/private/openai/gremlin.yaml` (name provisional) as the private
  runtime/operator policy source of truth. Keep the public `.ai` repository a
  reusable template.
- [ ] Split that policy into model guidance and deterministic runtime guards.
  Suggested fields: autonomy level, repository include/exclude rules, safe
  auto-actions, stop/ask conditions, maintenance thresholds, merge/release
  policy, scan limits and preferred high-level actions.
- [ ] Add validation for the private policy so a typo cannot silently loosen a
  guard.
- [ ] Add an operator bootstrap action that returns effective private policy,
  relevant repository instructions, capabilities and stop conditions in one
  compact response.
- [ ] Teach high-level actions to consume the same policy automatically where
  deterministic enforcement belongs, instead of copying rules into Custom GPT
  Instructions.
- [ ] Keep the Custom GPT instruction block small: personality + broad operating
  contract + “follow runtime operator policy”. Do not duplicate the policy into
  the 8k instruction field.
- [ ] Optionally generate a compact Builder/Knowledge pack from the private
  overlay so personality/reference material has a maintained source rather than
  hand-copied text.

## Autopilot

- [ ] Build a guarded account/repository autopilot loop:
  scan -> classify -> plan -> execute safe steps -> verify -> report.
- [ ] Start with maintenance because the read and cleanup primitives already
  exist. Global radar should choose repositories, then use detailed repo reports
  only where needed.
- [ ] Let deterministic policy auto-handle safe chores such as exact stale cache
  or artifact cleanup, orphan branch cleanup with expected SHA, reasonable
  workflow retries and final verification.
- [ ] Keep product/code decisions in the model. Runtime decides what is allowed;
  the model decides what the evidence means and what change to implement.
- [ ] Add resumable operation/checkpoint IDs if long multi-repository jobs begin
  hitting Action-call or request-duration limits.
- [ ] Add end-to-end release orchestration later: validate target -> dispatch
  build -> wait/diagnose -> collect artifact -> create/update release -> attach
  asset -> verify latest/release state.

## High-value follow-ups

- [ ] Nested `AGENTS.md` support for target directories, not only root guidance,
  in context/prepare/investigation flows.
- [ ] Improve workflow diagnosis to return failure-focused/tail log excerpts
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
- [ ] Account maintenance filters/priorities driven by private policy: ignored
  repos, cache thresholds, age thresholds and repository-specific exceptions.
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
- Never trade verification for autonomy: expected-SHA/snapshot guards, green
  relevant CI and final-state rechecks remain part of the machine.
