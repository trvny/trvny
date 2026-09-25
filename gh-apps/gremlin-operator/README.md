# Gremlin Operator

`gremlin-operator` is the guarded operator surface for GitHub, Cloudflare,
maintenance, workflow, coding, release, and policy automation.

The deployed Worker is intentionally thin. `src/index.ts` imports
`kanarek-companion/gremlin-core`, adds `/health`, and delegates the operator
routes to the maintained core implementation in
`../kanarek-companion/src/gremlin-router.ts` and its domain modules. This keeps
one source of truth for operator policy instead of cloning it into two Workers.

## Boundary

Gremlin owns semantic operator decisions and guarded high-level actions. It does
not own Kanarek status-comment/quip behavior, Kanarek Review provider routing,
or GPTomek's control-mailbox transport.

The main operator families live in the shared package:

- `operator-actions.ts`: PR inspection/finalization and composed GitHub reads.
- `autopilot*.ts`: resumable orchestration and operation checkpoints.
- `policy*.ts`: repository policy loading, enforcement, merge/release gates.
- `change-actions.ts`, `code-*.ts`, `*investigation*.ts`,
  `dependency-graph.ts`, `test-discovery.ts`: coding/investigation helpers.
- `maintenance*.ts`, `workflow*.ts`, `issue-actions.ts`,
  `lifecycle-actions.ts`: repository/account maintenance.
- `release*.ts`, `zip-entry.ts`: guarded release pipeline.
- `cloudflare-actions.ts`: guarded Cloudflare inventory, inspection, and narrow
  mutations.
- `gpt-actions.ts`: scoped low-level GitHub transport shared by guarded actions.
- `runtime-openapi.ts`: final curated action surface exposed to clients.

See
[`../kanarek-companion/docs/architecture.md`](../kanarek-companion/docs/architecture.md)
for the composition map and
[`../kanarek-companion/docs/state-and-safety.md`](../kanarek-companion/docs/state-and-safety.md)
for mutation/replay invariants.

## Mutation model

Prefer the guarded high-level operation for the job. Raw mutation families are
intentionally restricted so callers cannot bypass stale-state checks or policy.

Important patterns include:

- expected head/base/version identifiers before ref-changing or release actions;
- protected branches and explicit branch-delete guards;
- final PR re-inspection before merge/finalization;
- policy-enforced maintenance budgets;
- resumable `operationId` checkpoints with input hashing, leases, and stored
  results;
- fail-closed `uncertain` outcomes when a remote side effect may have happened
  but cannot be proven;
- bounded batch/orchestration surfaces rather than arbitrary admin proxies.

GPTomek remains the identity for bot-authored routine writes. Pull requests are
opened as `trvny` where required so external automatic review still triggers.

## Cloudflare operator

The Gremlin action surface can inspect Workers, Pages projects, zones,
deployments, routes, DNS, and Worker observability.

Cloudflare mutations are deliberately narrow. Existing-version rollback,
workers.dev state, and updates to existing routes or DNS records require fresh
expected IDs/state/snapshot hashes so stale reads fail closed. Worker secret
values and Pages build variables are never returned.

## Authentication and deployment

`gremlin-operator` has:

- `workers_dev: false`
- preview URLs disabled
- `CF_VERSION_METADATA`
- a remote `OPERATOR_CHECKPOINTS` Durable Object binding whose class is hosted
  by `kanarek-companion`
- GPTomek App/installation metadata in `wrangler.jsonc`

The operator implementation uses GitHub OAuth/App identity according to the
specific operation. Do not replace the guarded route with a generic unrestricted
GitHub or Cloudflare proxy.

From this directory:

```sh
npm run check
npm run deploy
```

Workers Builds should use `gh-apps/gremlin-operator` as the root directory.
