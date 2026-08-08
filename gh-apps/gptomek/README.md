# GPTomek

GitHub App used for bot-authored commits, comments, review replies, and
reactions.

- App ID: `4524407`
- Installation ID: `152126523`
- Runtime module: `../kanarek-companion/src/gptomek.ts`
- Shared Worker: `kanarek-companion`
- Worker secret: `GPTOMEK_PRIVATE_KEY`
- Control mailbox: `trvny/trvny#176` (merged PR body; no persistent branch)

The mailbox is intentionally branchless: a marked edit of the merged pull
request body is routed through the shared Worker's normal locked webhook path.

Pull requests remain opened as `trvny` so external automatic review continues
to trigger from the expected author.
