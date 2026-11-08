# Google account migration

Two **one-way copy** tools, not account synchronization. Source accounts remain read-only; never delete source data without verifying the destination.

| Service | Maintained code | Run / state |
| --- | --- | --- |
| YouTube + YouTube Music | [`migrate.py`](migrate.py) | [Daily workflow](../.github/workflows/yt-migrate.yml); quota-bound `state.json` |
| Contacts + Tasks + Calendar | [`google/migrate.py`](google/migrate.py) | [Google workflow](../.github/workflows/google-migrate.yml); encrypted checkpoint, write cap |

## Safe operation

- Follow [Google OAuth setup / dry run](google/README.md) for scopes, secrets and limits. Start its workflow with `dry_run=true`; only then enable writes.
- The YouTube workflow runs daily. Google schedule stays disabled unless `GOOGLE_MIGRATE_ACTIVE=true`, and skips completed copies.
- Keep `YT_*` and `GM_*` credentials/checkpoints separate. Never expose personal data in logs, PRs or README examples.
- These workflows **perform migrations**, so their badges should not be presented as CI/test status.
