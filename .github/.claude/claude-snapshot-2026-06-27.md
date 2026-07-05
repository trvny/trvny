# Claude State Snapshot

**Captured:** 2026-06-27T18:50Z · **User:** Bartek · **Location:** Trzebinia, Lesser Poland, PL

> Backup of *your* data only — memory, skills, connectors, preferences, project state.
> Anthropic's internal system instructions are not reproduced here (not your data).
> Paste this into a fresh Project's instructions or attach it to re-seed context in a new chat.

---

## 1. User Preferences (as set in Settings → Profile)

- Default to **minimal-wit-style** voice + **token-efficiency** rules unless asked otherwise or task needs formal/long-form prose.
- Lead with the answer/result. No preamble, no restating the question, no "great question" openers.
- No closing filler ("let me know if…", no recap).
- Match length/format to the question; reserve structure for genuinely multi-part answers.
- Don't stack hedges — answer, then at most one caveat if it matters.
- Code: show code first, explain only the non-obvious, prefer the simplest version that works.
- Suggest a relevant valuable idea.

---

## 2. Operating Doctrine (knowledge state)

**Core philosophy:** lean skill library, no-create/extend-first. Skills must add genuine capability
(project invariants, domain specifics, workflows, external docs). Skills wrapping baseline Claude
competence are prohibited — always-on token cost, zero gain.

**Stack:** Kotlin/Android, Python, TypeScript/Cloudflare Workers; GitHub as central platform.
GitHub write ops in chat go through the `github-mcp-server` connector (`/x/all` toolset).
`gh` CLI available in Claude Code, not authenticated in the chat sandbox.

**Skill architecture principles:**
- Skill `description` frontmatter is the *only* always-on token cost; bodies/refs load on trigger.
- Description triggering is best-effort; reliable always-on needs a Settings → Profile fallback.
- Disabling a skill/connector = uninstalled for token purposes; connector tools are usually deferred.

**Skill editing workflow:**
1. `/mnt/skills/user/` is read-only → copy to `/tmp/<name>/` before editing.
2. Edit → `python -m scripts.quick_validate` → `python -m scripts.package_skill <dir> <out>`
   (both run from `/mnt/skills/examples/skill-creator`).
3. Output `.skill` to `/mnt/user-data/outputs/`; folder name must match installed skill name.
4. Repackage + reinstall `skills-index` whenever the library changes.

**Frontmatter rules:** allowlist = `name, description, license, allowed-tools, metadata, compatibility`.
Description ≤1024 chars, no angle brackets, no unquoted colon-space (use em dash). `context: fork`
is an upload blocker — strip with `sed -i '/^context: fork$/d'`.

**GitHub connector facts:**
- `push_files` = multi-file atomic commit; no move primitive (re-push then `delete_file`).
- `delete_file` needs no SHA; `create_or_update_file` does.
- Connector is read-only for releases/tags → use `workflow_dispatch` or local `git tag`.
- `get_repository_tree` + `path_filter=".github/skills"` + `recursive=True` audits skill presence.
- Repo skills live at `.github/skills/<name>/`, not repo-root `skills/`.

---

## 3. Projects (travino org, all default branch `main`)

| Repo | What | Stack |
|---|---|---|
| **autka** | Used-car aggregator | Kotlin/Compose Android + Cloudflare Workers backend |
| **feeds** | Two subsystems: `feedseek/` (Python Atom/RSS gens, hourly cron) + `feedget/` (Compose news widget + CF Worker) | Python + Kotlin + Workers |
| **tvpi** | Polish IPTV aggregator | Cloudflare Worker + raw GitHub mirror + generate.py |

**autka invariants:** No scraping (Otomoto/OLX need compliant feed agreement; Facebook deep-link only;
US auctions = client-side import cost calc). Single `BackendCarOfferSource` (not per-marketplace Hilt
adapters). osmdroid/OpenStreetMap (no API key). `core/` splits into `model/` + `util/`. AGP 9 removed
`android.kotlinOptions` DSL → use top-level `kotlin { compilerOptions {} }`.

**autka open items:**
- Apply `references/android.md` patch: Compose BOM update, compileSdk 37 warning, Coil/Retrofit 3.x major-bump flags.
- Verify Kotlin, KSP, Hilt, Room, coroutines, Navigation, osmdroid against live `libs.versions.toml`.
- Compose BOM stale; compileSdk/targetSdk at 35, Play deadline anticipated for API 36.

---

## 4. Skill Library (installed)

Hub: `skill-creator-v2`. Registry: `skills-index` (repackage on every change).
Default-on via descriptions + Profile pin: `minimal-wit-style`, `token-efficiency`.

| Skill | Role |
|---|---|
| skill-creator-v2 | Skill lifecycle hub — create/edit/optimize/eval, compat audit |
| skills-index | Central registry / map of the library |
| github-ops | Connector-based GitHub ops + pre-merge gate |
| github-release | End-to-end GitHub library release (SemVer + Keep a Changelog) |
| github-actions-efficiency | Audit Actions for CI minutes/cost |
| dependabot | dependabot.yml + Dependabot PR / GHAS management |
| cloudflare | Workers/Pages/KV/D1/R2/AI/Wrangler |
| autka | travino/autka project skill |
| feeds | travino/feeds feedseek/ generators |
| feedget | travino/feeds feedget/ widget + Worker |
| tvpi | travino/tvpi IPTV project skill |
| minimal-wit-style | Default writing voice — brevity + dry wit |
| token-efficiency | How to write/act to save tokens |
| context-optimizer | Claude Code session/context management |
| chat-context | claude.ai conversation/usage hygiene |
| prompt-optimizer | Rough idea → finished chat prompt |
| from-pdf-skill-builder | Build a skill from PDFs (vision extraction) |
| typescript-resilient-fetch | Type-safe fetch/retry/validate (incl. tvpi) |
| python-scraping-feeds | Python fetch/parse → RSS/Atom/M3U |
| microsoft-docs | Query Microsoft Learn docs |
| english-polish | Quietly correct all-English messages |
| r8-analyzer | Android R8/Proguard keep-rule analysis |
| edge-to-edge | Compose edge-to-edge migration |
| web-asset-generator | Favicons/PWA icons/OG images |
| conversation-analyzer | Analyze own past chats for patterns |
| playground | Interactive single-file HTML explorers |
| theme-factory | Theme/style artifacts |
| web-artifacts-builder | Complex React/Tailwind/shadcn artifacts |
| batch-files | Windows .bat/.cmd scripting |
| mcp-builder | Build MCP servers (FastMCP / TS SDK) |
| update | Sync tasks + refresh memory from chat activity |
| cmd-morning-check | One-shot health check across all 3 repos |
| cmd-release | Cut a release per-repo (tvpi/autka/feeds) |

> Note: this is the union of currently-visible skill entries. Memory recorded "32 then 30 after a
> cleanup"; reconcile against the live claude.ai/skills UI if exact count matters.

---

## 5. Connectors (MCP servers, with URLs)

| Name | URL |
|---|---|
| Bitly | https://api-ssl.bitly.com/v4/mcp |
| Claude Docs | https://code.claude.com/docs/mcp |
| Cloudflare | https://mcp.cloudflare.com/mcp |
| Cloudflare Builds | https://builds.mcp.cloudflare.com/mcp |
| Cloudflare Developer Platform | https://bindings.mcp.cloudflare.com/mcp |
| Cloudflare Docs | https://docs.mcp.cloudflare.com/mcp |
| GitHub (all toolset) | https://api.githubcopilot.com/mcp/x/all |
| GitHub | https://api.githubcopilot.com/mcp |
| Google Drive | https://drivemcp.googleapis.com/mcp/v1 |
| MDN | https://mcp.mdn.mozilla.net |
| Microsoft Learn | https://learn.microsoft.com/api/mcp |
| OnlyOffice | https://mcp.onlyoffice.com/mcp |
| status-mcp | https://status-mcp.travny.workers.dev |
| Zapier | https://mcp.zapier.com/api/v1/connect |

---

## 6. Tools & Paths

- **claude.ai/skills** — skill install/management UI.
- Skill toolchain: `quick_validate`, `package_skill` at `/mnt/skills/examples/skill-creator/` (run as Python modules).
- Paths: installed (read-only) `/mnt/skills/user/`; working copies `/tmp/<name>/`; outputs `/mnt/user-data/outputs/`.
- PDF extraction: `pdftoppm -png -r 170` + sequential vision reads (pdftotext unreliable for multi-column landscape).

---

## 7. Working Style

Terse and directive; mixes Polish and English. Links to correct locations rather than describing them.
Read-before-write (named anti-pattern to violate). Batch decisions upfront — full triage/verdict table,
one clarifying question only when a fork genuinely matters, then execute. Extend-first before creating.
YAGNI discipline — flags standing infra for rare ops as over-engineering.

---

*End of snapshot. Memory updates in the background, so the live state may have moved since capture.*

---

# Memory

## Work context
Bartek (GitHub: travino) is a developer working primarily on personal projects hosted under the travino namespace. His main projects include tvpi (a TypeScript Cloudflare Worker serving Polish IPTV playlists), feeds (a Python-based RSS/Atom feed generator), autka (a used-car aggregator with a Cloudflare Worker backend and Android app), and a weather aggregator Worker at weather.travny.workers.dev.

## Personal context
Bartek communicates in a casual mix of Polish and German, reflecting a bilingual style. He uses Firefox Android as his mobile browser and runs an unrooted Sony Xperia XA2 (Android 9). He has an interest in Android customization, IPTV, and self-hosted tooling.

## Top of mind
Bartek has been actively iterating on his Cloudflare Worker weather aggregator (weather-feed/src/ in travino/travino), most recently adding retry/backoff logic to fix intermittent source dropouts and implementing a per-source last-good KV cache so the median ensemble stays at 3 sources even when one temporarily fails. Prior to that, he extended the worker with UV index and air quality/pollen data (Open-Meteo Air Quality API, European AQI bands, CAMS pollen counts) with a new landing page card and Atom feed triggers on AQI band transitions.

## Brief history

### Recent months
WiFi-Automatic fork (travino/WiFi-Automatic): Bartek revived and modernized this Android app — cherry-picking changes from three upstream forks, fixing Bluetooth bugs, adding new auto-off conditions, migrating to AndroidX + AGP 9 on a branch, cutting the first tagged release (v2.1.0), and opening a cross-fork upstream PR to j4velin/WiFi-Automatic#77. CI hardening (concurrency groups, signing secret fixes) was applied across the repo.
CI/infrastructure hardening sweep: Applied across tvpi, feeds, and autka — concurrency cancellation, npm ci caching, dependabot coverage. tvpi's refresh.yml and deploy.yml were the main gaps fixed.
status-mcp Worker: Built a Cloudflare Worker MCP server (mcp/status-mcp/ in travino/travino) providing a single status tool fanning out health checks across tvpi, feeds, and autka in parallel, using service bindings for same-account Workers to avoid hairpin failures.
Firefox Android + claude.ai userscript: Built a Violentmonkey userscript for claude.ai performance (CSS containment, animation killing, content-visibility: auto on message turns and code blocks). Also configured a UA-switcher extension to fix claude.ai mobile file upload issues.
ADB optimization for XA2: Explored no-root battery and performance optimization via ADB (pm uninstall --user 0, appops, standby buckets, dumpsys batterystats). Also researched LineageOS for microG (pioneer build, Android 16 / LineageOS 23.2) as a longer-term upgrade path, noting bootloader unlock trade-offs (DRM key loss, Play Integrity, NFC payments).
Custom Claude skills: Audited and fixed 23 skills for claude.ai chat compatibility — stripping forbidden frontmatter keys, rewriting the update skill for connector-first operation, and updating project skills (tvpi, feeds) to reflect the GitHub connector as the primary path for private repos.

### Earlier context
IPTV playlist probing: Wrote a Python/ffprobe concurrent stream prober against a 110-entry M3U playlist, identifying dead vs. geo-blocked streams and flagging Bartek's own tvpi Worker endpoints returning 4XX errors.
Claude skills authoring: Created python-scraping-feeds and typescript-resilient-fetch skills from analysis of tvpi and feeds repos, then generalized them with broader library tradeoffs. Also rewrote token-efficiency and context-optimizer skills with factual corrections and a cleaner division of labor; produced chat-adapted variants (concise-responses, chat-context) and a paste-ready user preferences block.
JSON quote file deduplication: Merged zenquotes.json into quotes.json (11,052 final entries), deduplicating with whitespace and quotation-mark normalization.
Cloudflare MCP architecture: Clarified that mcp.cloudflare.com/mcp (Code Mode) subsumes the three specialized Cloudflare MCP servers and running all four simultaneously is redundant.
PowerShell profile review: Confirmed two using namespace declarations in Bartek's profile were unnecessary; flagged minor style issues ($color/$Color inconsistency, Get-Random -Max 16 exclusivity).

## Long-term background
Claude Code configuration: Explored consolidating ~/.claude, ~/.claude.json, and ~/Claude under a single directory via CLAUDE_CONFIG_DIR; noted Windows NTFS case-insensitivity makes a true rename impossible.
GitHub MCP connector setup: Worked through GitHub OAuth App configuration for the api.githubcopilot.com/mcp endpoint after dynamic client registration failed.
Coreutils for Windows troubleshooting: Diagnosed a known upstream installer bug (issue #17) and provided manual PATH and profile workarounds.

## Other instructions
For the GitHub MCP custom connector in Claude (api.githubcopilot.com/mcp): GitHub does not support dynamic client registration — a GitHub OAuth App must be created manually, and both the Client ID and Client Secret must be entered in the connector's Advanced settings (PKCE alone is insufficient; the secret is required). Callback URL: https://claude.ai/api/mcp/auth_callback.

