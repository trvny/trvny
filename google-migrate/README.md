# Google account migration

One-way **copy** from old (`SRC`) to new (`DST`) account. Source data never deleted or modified.
Initial scope: **Contacts** (common fields) and **Google Tasks** (lists, subtasks, due/completion). Not a complete Google Takeout restore.

## Without a local CLI

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library), use an OAuth project you control. Enable **People API** and **Google Tasks API**. No `gcloud` install needed.
2. Configure an OAuth desktop/installed client or a web client for [OAuth Playground](https://developers.google.com/oauthplayground/) (authorized redirect `https://developers.google.com/oauthplayground`). Authorize each Google account separately. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/contacts` and `https://www.googleapis.com/auth/tasks`. OpenID subject IDs are checked so both tokens cannot point at the same account. Request offline access and obtain refresh tokens. The old account is **source**, the new one **destination**. Never post tokens in GitHub issues, PRs, or chat.
3. Add GitHub Actions repository **secrets**: `GM_CLIENT_ID`, `GM_CLIENT_SECRET`, `GM_SRC_REFRESH`, `GM_DST_REFRESH`, `GM_STATE_KEY` (long randomly generated passphrase). The old YouTube refresh tokens do **not** automatically include these scopes.
4. Dispatch [google-migrate](../.github/workflows/google-migrate.yml) with **dry_run=true**. Review the counts in the job summary; nothing is written. Then run again with **dry_run=false** after checking both accounts are correct.
5. If a run reaches the 200-write guardrail, enable repository variable `GOOGLE_MIGRATE_ACTIVE=true` for daily resumption; otherwise manually re-run. Clear the variable after completion. Scheduled jobs skip once checkpoint marks both services complete.

**OAuth note:** An OAuth consent screen in *Testing* can issue refresh tokens expiring after 7 days. Use an appropriate consent/publishing setup for a long-running migration. API-specific quota/errors can still interrupt a run; it is safe to restart with the same encrypted checkpoint.

## Safety / limits

- **No deletes, no source mutations.** New contacts only when no matching destination email/phone/fingerprint was found. Matching destination contacts are not overwritten or merged. Contact groups and photos are **not copied** in this first version; export them separately from Takeout.
- Tasks lists are created with ` (migrated)` suffix to avoid touching destination lists. New task IDs are tracked in an encrypted checkpoint so restarts do not duplicate previously copied tasks. Assigned Google Docs/Chat tasks cannot be recreated via Tasks API; counted as skipped. Parent-child structure is retained, but Tasks API drops the time-of-day portion of due dates.
- Existing `(migrated)` list without a checkpoint causes a safe failure instead of risking duplicate tasks. **Keep `GM_STATE_KEY` unchanged** and preserve the Actions cache through the migration. Do not clear caches during the run.
- Data and item titles never appear in the logs; only counts/status codes. State contains Google IDs, so it is encrypted before being stored in Actions cache. Checkpoint is also sensitive: don't upload its plaintext to GitHub.
- The 200 write limit is a conservative per-run safety cap, not a claim about Google's daily quotas. Dry runs don't consume write allowance. The scheduled job does not run until `GOOGLE_MIGRATE_ACTIVE=true`.
- Gmail, Drive, Calendar, Photos, Maps and Keep need separate migration strategies and are deliberately outside this initial implementation.
