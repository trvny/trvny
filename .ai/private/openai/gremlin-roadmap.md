# Gremlin / GPTomek roadmap

Private roadmap for the Custom GPT operator in `trvny/trvny`.
Keep this capability-oriented and evergreen. Do not store current SHAs, transient
incidents or step-by-step session history here.

## Operating foundation

- [x] Split `trvny` OAuth identity from ordinary `gptomek[bot]` writes.
- [x] Private fail-closed runtime policy plus dedicated Gremlin style profile.
- [x] Compact Builder instructions with an enforced size budget.
- [x] Repository bootstrap, scoped/nested `AGENTS.md` guidance and guarded change preparation.
- [x] Guarded file/branch/PR/issue/workflow/release operations.
- [x] Expected-SHA/snapshot guards, self-describing conflicts and request-local read reuse.
- [x] PR inspection/finalization with paginated review threads.
- [x] Failure-focused workflow diagnosis and bounded workflow control.
- [x] Account maintenance scan/autofix and account PR/issue attention radar.
- [x] Resumable operator autopilot with strongly consistent checkpoints.
- [x] Live capability/version manifest and harmless authenticated/post-deploy smoke checks.
- [x] Resumable release orchestration from validated target through artifact/release verification.

## Release pipeline

- [x] Exact artifact ZIP -> release asset upload.
- [x] Exact release-asset deletion.
- [x] Extract one exact artifact entry (APK/AAB/checksum/etc.) and publish it as a release asset.
- [x] Safe replace-release-asset flow: exact old snapshot -> delete -> fresh source snapshot -> upload -> verify.
- [ ] Teach release orchestration to optionally use exact artifact entries instead of only whole artifact ZIPs.

## Coding operator

Build these in roughly this order. Prefer high-level workflows that remove model/API round trips;
do not wrap every GitHub endpoint for its own sake.

- [x] **Symbol/reference investigation.** Locate a named function, class, type or constant,
  classify definitions/references/imports/implementations on an exact snapshot and surface matching tests.
- [ ] **Blame and focused history.** For a file/symbol/line range, return the commits/PR context
  that explains how the code got there and helps identify regressions.
- [ ] **Dependency/import graph.** Show what a target imports and the bounded set of callers or
  modules likely affected by a change.
- [ ] **Targeted test discovery.** Given changed/target files, discover the smallest relevant
  test/typecheck/lint/build commands while retaining full CI as the final gate.
- [ ] **Code-change autopilot.** Compose goal -> scoped instructions -> investigation -> minimal
  edit -> targeted verification -> commit/PR -> CI/review -> merge/cleanup. Semantic code choices
  stay with the model; deterministic safety/state transitions stay in the Worker.
- [ ] **Refactor-aware editing.** Support rename/move operations with before/after reference
  snapshots and verification that stale references were not left behind.
- [ ] **Bug investigation mode.** Connect issue/stack trace/CI failure -> relevant symbol/history ->
  reproduction or targeted test -> fix -> verification.
- [ ] **Focused code-review pass.** Pre-merge analysis for missed callers, API-contract drift,
  unsafe null/state handling, race-prone changes, missing edge cases and accidental scope growth.

## Architecture / ergonomics

- [ ] Generate an optional compact Builder/Knowledge pack from private `.ai` sources.
- [ ] Introduce a central Action registry if router/OpenAPI registration duplication keeps growing.
- [ ] Add further code-investigation ergonomics only when they demonstrably remove round trips.

## Design constraints

- One source of truth per concern.
- Public `.ai` stays reusable; personal/operator policy stays private.
- Guarded high-level actions are preferred over raw mutation endpoints.
- GPTomek performs normal bot-authored writes; intentionally human-authored operations stay `trvny`.
- Policy may narrow behavior but never weakens hard runtime safety guards.
- Never persist OAuth bearer tokens in checkpoints.
- Interrupted or uncertain mutations recover by verification, not blind replay.
- Final merge/release gates require fresh state, exact expected snapshots and applicable green CI/review state.
