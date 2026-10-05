# Gremlin

`gremlin` is the guarded operator surface for GitHub, Cloudflare, maintenance,
workflow, coding, release, and policy automation: the Custom GPT actions
(`/gpt-actions/**`), the specialist MCP (`/mcp`), and the specialist routes.

The Worker is intentionally thin. `src/index.ts` imports the full action runtime
from `kanarek-companion/runtime` (`../kanarek-companion/src/runtime.ts`), adds
its own `/health`, and returns 404 for Kanarek-only ingress (GitHub webhook,
GPTomek wake, private review router). This keeps one source of truth for
operator policy instead of cloning it into two Workers.

### Migration status

`kanarek-companion` still serves the same Gremlin surface on its own origin.
Cutover:

1. Deploy this Worker and set its secrets (below).
2. Point the Custom GPT actions/OAuth URLs and `plugin/mcp.json` at the
   `gremlin` origin; point tg-assistant's `BOTEK_SPECIALISTS` binding at it once
   the Botek entrypoint moves here.
3. Remove the Gremlin surface from `kanarek-companion` and move the
   Gremlin-only modules into this package. Rename the served subsystem id
   (`gremlin-operator`) and OpenAPI title (`Gremlin Operator`) then, not
   earlier: the live GPT reads them from `kanarek-companion`. tg-assistant's
   `KANAREK_COMPANION` binding only uses the review router and stays.

## MechaGremlin plugin

`plugin/` is the maintained plugin-side migration source for MechaGremlin. It
belongs here because Gremlin owns the user-facing guarded operator
surface. The package may still point at a shared public MCP transport while the
runtime implementation remains imported from `kanarek-companion`; transport
location does not change subsystem ownership.

The legacy Custom GPT remains untouched until the migrated plugin reaches
capability parity and passes the migration acceptance gates in
`plugin/skills/mechagremlin/references/migration.md`.

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

`gremlin` has:

- `workers_dev: true` (public origin for the GPT and MCP; preview URLs disabled)
- `CF_VERSION_METADATA`
- remote `OPERATOR_CHECKPOINTS` and `ANCHOR_MUTATION_REPLAYS` Durable Object
  bindings whose classes are hosted by `kanarek-companion`, so GPTomek and
  Gremlin share one checkpoint/replay store
- GPTomek App/installation and Anchor folder metadata in `wrangler.jsonc`

Code deploys via Workers Builds on pushes to `main` that touch
`gh-apps/gremlin/**` or `gh-apps/kanarek-companion/src/**` (build
`npm run check`, deploy `npx wrangler deploy`). Secrets: run the
`Sync Worker credentials` workflow (`automation-sync.yml`) with target
`gremlin`. It copies `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and, when
present as repository secrets, `GPTOMEK_PRIVATE_KEY`, `ENGRAM_API_KEY`,
`CONTEXT7_API_KEY`, then checks `/health`. Only a missing
`GPTOMEK_PRIVATE_KEY` or `ENGRAM_API_KEY` raises a warning; `CONTEXT7_API_KEY`
is skipped silently. The sync never deletes Worker secrets.

The operator implementation uses GitHub OAuth/App identity according to the
specific operation. Do not replace the guarded route with a generic unrestricted
GitHub or Cloudflare proxy.

From this directory:

```sh
npm run check
npm run deploy
```

Workers Builds should use `gh-apps/gremlin` as the root directory.
