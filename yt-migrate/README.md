# Account migration (old Google account -> new)

Single home for the one-way Google account migration tools. Source accounts are read-only; do not delete old account data until independently verified on the destination.

| Service | Implementation | Workflow | State |
| --- | --- | --- | --- |
| YouTube / YouTube Music | [`migrate.py`](migrate.py) | [`yt-migrate.yml`](../.github/workflows/yt-migrate.yml) | `yt-migrate/state.json`, daily quota-bound |
| Contacts / Google Tasks / Calendar | [`google/migrate.py`](google/migrate.py) | [`google-migrate.yml`](../.github/workflows/google-migrate.yml) | Encrypted Actions-cache checkpoint, write-capped |

Read [Google Contacts/Tasks/Calendar setup](google/README.md) for OAuth scopes, secrets, dry-run and limitations.

The workflow files remain separate because they need distinct API permissions, quotas and checkpoint handling. The YouTube workflow runs daily; the Contacts/Tasks/Calendar schedule requires `GOOGLE_MIGRATE_ACTIVE=true` and stops copying after completion. The migration is **not** ongoing two-way account sync.
