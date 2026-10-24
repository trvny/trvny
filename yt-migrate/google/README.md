# Google account migration

One-way **copy** from old (`SRC`) to new (`DST`) account. Source data never deleted or modified.
Initial scope: **Contacts** (common fields) and **Google Tasks** (lists, subtasks, due/completion). Not a complete Google Takeout restore.

## Without a local CLI

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library), reuse the **existing `yt-migrate` Google Cloud project**. Enable **People API** and **Google Tasks API**. No `gcloud` install needed.
2. Reuse the existing **`YT_CLIENT_ID`** and **`YT_CLIENT_SECRET`** GitHub secrets. To authorize via [OAuth Playground](https://developers.google.com/oauthplayground/), the client must be a **Web application** with `https://developers.google.com/oauthplayground` added to its authorized redirect URIs. If the YouTube client is a **Desktop** client (or you cannot add that redirect), create an additional **Web application** OAuth client in the *same project* and provide its credentials as optional `GM_CLIENT_ID` / `GM_CLIENT_SECRET` secrets. Leave the working YouTube credentials and grants untouched.
3. In OAuth Playground, select **Use your own OAuth credentials** and request offline access. Authorize each account separately for `openid`, `email`, `https://www.googleapis.com/auth/contacts` and `https://www.googleapis.com/auth/tasks`. Request a fresh refresh token for each account. OpenID subject IDs are checked so both tokens cannot point at the same account. Old account = **source**, new account = **destination**. Never post tokens in issues, PRs, or chat.
4. Add GitHub Actions repository **secrets**: `GM_SRC_REFRESH` (old account token), `GM_DST_REFRESH` (new account token), and `GM_STATE_KEY` (long random passphrase). `GM_CLIENT_ID` and `GM_CLIENT_SECRET` are **optional overrides**, used only when a different OAuth client is required. Existing YouTube refresh tokens do **not** automatically include these scopes.
5. Dispatch [google-migrate](../../.github/workflows/google-migrate.yml) with **dry_run=true**. Review the counts in the job summary; nothing is written. Then run again with **dry_run=false** after checking both accounts are correct.
6. If a run reaches the 200-write guardrail, enable repository variable `GOOGLE_MIGRATE_ACTIVE=true` for daily resumption; otherwise manually re-run. Clear the variable after completion. Scheduled jobs skip once checkpoint marks both services complete.

**OAuth note:** An OAuth consent screen in *Testing* can issue refresh tokens expiring after 7 days. Use an appropriate consent/publishing setup for a long-running migration. API-specific quota/errors can still interrupt a run; it is safe to restart with the same encrypted checkpoint.

## Safety / limits

- **No deletes, no source mutations.** New contacts only when no matching destination email/phone/fingerprint was found. Matching destination contacts are not overwritten or merged. Contact groups and photos are **not copied** in this first version; export them separately from Takeout.
- Tasks lists are created with ` (migrated)` suffix to avoid touching destination lists. New task IDs are tracked in an encrypted checkpoint so restarts do not duplicate previously copied tasks. Assigned Google Docs/Chat tasks cannot be recreated via Tasks API; counted as skipped. Parent-child structure is retained, but Tasks API drops the time-of-day portion of due dates.
- Existing `(migrated)` list without a checkpoint causes a safe failure instead of risking duplicate tasks. **Keep `GM_STATE_KEY` unchanged** and preserve the Actions cache through the migration. Do not clear caches during the run.
- The workflow also restores the former `google-migrate/` encrypted cache (v1) once after this directory move, then saves new checkpoints under `yt-migrate/google/` (v2). Do not change `GM_STATE_KEY`.
- Data and item titles never appear in the logs; only counts/status codes. State contains Google IDs, so it is encrypted before being stored in Actions cache. Checkpoint is also sensitive: don't upload its plaintext to GitHub.
- The 200 write limit is a conservative per-run safety cap, not a claim about Google's daily quotas. Dry runs don't consume write allowance. The scheduled job does not run until `GOOGLE_MIGRATE_ACTIVE=true`.
- Gmail, Drive, Calendar, Photos, Maps and Keep need separate migration strategies and are deliberately outside this initial implementation.
