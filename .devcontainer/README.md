# Codespaces AI Devbox

Reusable, on-demand development machine. Actions remain the default for CI,
builds, schedules and repeatable automation. Use Devbox for interactive work,
agent sessions, browser investigations and tasks needing a persistent shell.

## Launch

1. Open `trvny/trvny` on GitHub: **Code → Codespaces → Create codespace**.
2. Select the `feat/codespaces-ai-devbox` branch until this PR merges.
3. Select **4 cores / 8 GB**. Switch to **8 cores / 16 GB** only for heavy builds.
4. Wait for `onCreateCommand` / `postCreateCommand` to finish. In the terminal: `devbox doctor`.

The universal Linux image supplies Bash, Git, GitHub CLI, Python, Node, Java,
Maven, Gradle and other common runtimes. Setup adds uv, Antigravity CLI (`agy`),
Copilot CLI, Hermes CLI, Playwright Chromium, official uBlock Origin Lite, yt-dlp and ffmpeg.
The Hermes installer skips its separate browser download to avoid duplication.
The default core utilities include 7-Zip (`7z`), `jq`, `rg`, `fd` (from
Debian's `fdfind`), `tree`, `file`, `bc`, ImageMagick and ShellCheck.
Package versions for Copilot, Playwright and Playwright CLI
are pinned in the sole npm manifest at `.devcontainer/tools/package.json`;
transitive packages are resolved in the user-local install. Vendor install
scripts for uv, Antigravity and Hermes track upstream releases. These scripts
are fully downloaded before execution, but this is not checksum pinning.


```bash
devbox doctor
devbox clone trvny/feedseek
devbox clone travnie/aistee
devbox browser https://example.com /tmp/example.png
devbox install browser
devbox install hermes
devbox download "https://www.youtube.com/watch?v=EXAMPLE"   # MP4 first, prefer up to 2160p
devbox download --audio "https://www.youtube.com/watch?v=EXAMPLE" # MP3
devbox download --best "https://www.youtube.com/watch?v=EXAMPLE"  # No 2160p sorting preference
devbox files                                           # Files ready to collect
devbox maintenance        # Read-only disk/cache report
devbox clean              # Prune old Devbox-owned temp files
devbox clean --deep       # Also prune package-manager caches
```

Other repositories are cloned into `~/workspaces/<owner>/<repo>`. Their own
instructions and build requirements still apply. The Devbox does not copy
project-specific scripts or create duplicate CI.

## GPTomek remote power and diagnostics

The maintained control path is **GPTomek Issue #203 -> GPTomek Worker's
checkpointed `operator_action` -> `repository_dispatch` -> GitHub Actions
`.github/workflows/devbox-control.yml` -> personal Codespaces API**.
No persistent remote-control daemon or second Cloudflare Worker is introduced.
The Action runs on GitHub's infrastructure even if Legion and Codespaces are
both switched off. Its user-level API adapter is
`.devcontainer/codespaces_control.py`.

**One-time account setup required:** The GPTomek installation token can
dispatch repository events but **cannot create a personal Codespace**.
After the workflow reaches `main`, create a short-lived fine-grained GitHub
PAT owned by **trvny**, limited to **trvny/trvny** with repository
`Codespaces: Read and write`, `Codespaces lifecycle admin: Read and write`,
and `Codespaces metadata: Read` as required by the relevant API endpoints.
Store it solely as the Actions repository secret
`DEVBOX_CODESPACES_TOKEN`. Do not paste it in this chat, an Issue, an agent
config, a PR, or Cloudflare; do not give it access to organizational repos.
Set a spending budget/usage cap in GitHub Billing before creating machines.
If GitHub's fine-grained permissions differ for the SSH CLI, keep lifecycle
control working and verify SSH diagnostics separately rather than granting
broad permissions blindly.

Until **both** the workflow is merged to default branch `main` **and** this
secret is configured, GPTomek **cannot launch Devbox**. The repo does not
create secrets or codespaces by itself.

To dispatch from Issue #203, submit a fresh comment consisting entirely of
the following fenced JSON block, with a unique `id` per new operation:

````markdown
```gptomek
{
  "id": "devbox-ensure-unique-id",
  "op": "operator_action",
  "repository": "trvny/trvny",
  "method": "POST",
  "path": "/repos/trvny/trvny/dispatches",
  "body": {
    "event_type": "devbox-control",
    "client_payload": { "action": "ensure" }
  },
  "expect": "empty"
}
```
````

Allowed `client_payload.action`: `status`, `ensure`, `stop`, `doctor`,
`agents`. `ensure` creates the **one** personal Devbox on `main` if missing,
or starts the existing stopped one. It selects the smallest available **4 CPU,
8-16 GiB** machine, requests `EuropeWest`, stops after **15 idle minutes**, and
uses **7-day stopped retention** (uncommitted changes may disappear when GitHub
deletes the Codespace after retention; push your work). `status` lists only
this Devbox, `stop` stops only this Devbox. `doctor` and `agents` execute
two built-in read-only checks over GitHub CLI Codespaces SSH (subject to
user-token permissions and first-run SSH availability). They do not accept
arbitrary shell commands. Each result is in the **GPTomek Devbox control**
Actions run logs; GPTomek's own comment confirms only dispatch acceptance,
not that the machine has finished starting.

The workflow accepts dispatches from the verified `gptomek[bot]` identity
or manual `workflow_dispatch` by `trvny`, serializes runs to avoid duplicate
creation, and refuses repository/owner/billing mismatches. No prebuild is
enabled. Full agent task execution is **not** a side effect of starting a
Codespace: future integration should reuse Pet Dispatcher's existing policy,
sessions and job envelope through a *scoped* Linux worker rather than
allowing arbitrary shell strings through Issue comments.

## Optional tool profiles, MCP and skills

```bash
devbox install base          # Core utilities and Python uv
devbox install android       # Official Google Android CLI + Apktool
devbox install android-sdk   # Android SDK command-line tools and platform-tools
devbox install cloud         # Official Google Cloud CLI (gcloud)
devbox install mcp           # Pinned agent CLIs + Playwright CLI skills
devbox doctor                # Verify executables and optional components
```

Android CLI is installed using Google's official user-local installer.
`android sdk` manages SDK packages; Android SDK's `sdkmanager` is a separate
older tool, not another copy of Android CLI. Install individual Android
platforms/build-tools only when a project requires them. `android init`
provides Google's Android CLI skill for a project after installation, if
needed. Hardware virtualization and USB device access may not be available
inside Codespaces, so don't assume a local Android emulator will work.

The `gcloud` installer does not log into your Google account; authenticate
explicitly from your own interactive terminal. No service-account JSON keys or
Cloudflare production secrets are imported.

The repo's `.mcp.json` configures **remote Context7** over HTTP.
We intentionally do not start a filesystem MCP server: clients can advertise
dynamic Roots that broaden its file access, while local agents already have
workspace tools. Other MCP clients may need their own native configuration.
See `.agents/skills/devbox-workflow/` and
`.agents/skills/devbox-handoff/` for project-local operational guidance;
Playwright CLI also installs its upstream skill into user-level agent skills.
There is no separate model-provider MCP or cloned secret store.

Installing tools costs Codespaces disk space but idle executables consume
negligible CPU. Cloud and Android SDK are intentionally optional because
platform/build-tools downloads can be large.

## Media downloads (yt-dlp)

`devbox download URL` (alias `devbox fetch URL`) downloads **one item**,
never a playlist. It uses a single maintained preset in
`.devcontainer/media.py`:

- MP4 video + M4A audio first, then complete MP4, then other viable formats.
  Prefer resolution up to 2160p and higher FPS (`-S res:2160,fps`).
  `--best` removes the 2160p sorting preference. Neither flag overrides the
  4 GiB per-item download guard.
- Include metadata and chapter markers when available. Embed subtitles matching
  English (`en.*`) and Polish (`pl.*`); prefer SRT, with other formats as fallback.
  Embedded subtitle files are not preserved as separate downloads.
- File names: restricted ASCII characters, truncated uploader/title and unique ID.
- `--audio`: best audio source converted to MP3 with quality `0`, metadata
  and a JPEG cover. No thumbnail crop/re-encode filter: preserve artwork.
- `--ignore-config` avoids importing machine-local yt-dlp configuration into
  the controlled handoff. Audio extraction and metadata require `ffmpeg`.
- Preflight requires at least 5 GiB available for video or 512 MiB for audio.
  yt-dlp requests a 4 GiB per-item limit, but merge/post-processing can still
  exceed this size, and the source may not report size in advance.

```bash
devbox download "https://example.com/watch?v=..."      # MP4-first, prefer 2160p
devbox download --best "https://example.com/watch?v=..."  # Highest resolution
devbox download --audio "https://example.com/watch?v=..." # MP3 with cover
devbox files
devbox handoff "exact filename.mp4"
```

**Private phone handoff:** `devbox handoff` starts a time-limited, one-use
download page on port 8765. Ensure this Codespaces port is **Private** (never
Public). Authenticate to GitHub in the browser, open the link printed by the
command, then tap **Download file**. The server deletes the source after its
entire HTTP response has been transmitted; it cannot independently prove the
Android download manager has saved the file successfully. Interrupted streams
retain the file for retry. If in doubt, use VS Code Explorer's Download action
instead, then delete the file manually: Explorer cannot notify the handoff.

Files live in ignored repository-root `downloads/`, never in Git or Releases.
No playlists, browser cookies or DRM bypass. Downloads may fail on sites
blocking datacenter IPs or requiring authentication. Only save content you have
permission to download. Do not expose the handoff token or forward the port
publicly. Files remain charged as Codespaces storage until deleted.

## Playwright and uBlock Origin Lite

`devbox browser` runs **Playwright-bundled Chromium** in a **persistent,
headless context**, with the unmodified uBOL extension side-loaded. It
downloads the Chromium ZIP from the official
[uBOL releases](https://github.com/uBlockOrigin/uBOL-home/releases);
no browser-store mirrors, third-party CRX services or manifest patches.

Extension path: `~/.local/share/travny-devbox/ubol`.
Browser profiles: `~/.local/share/travny-devbox/chromium-profiles/`.

The launcher exports `launchWithUbol()` for scripts and agents to import from
`.devcontainer/browser.mjs` instead of duplicating browser flags. Provide a
unique `profileName` for concurrent agents; the default is `default`.
`devbox browser` uses a temporary per-process profile, checks HTTP success and
cleans that profile afterward. It is not a remote browser-control service.
Regular Playwright contexts and Hermes's own browser sessions do **not**
automatically inherit uBOL. Chrome/Edge cannot side-load extensions through
the same flags. Do not launch two Chromium contexts against the same profile.

The browser profile can contain cookies and authenticated sessions. Do not
commit it, share it, or forward remote debugging ports publicly.

## Agents and provider access

- `agy`: sign in to Google interactively. AI Plus does not grant a Gemini API
  quota to arbitrary agents.
- `copilot`: authenticate with the GitHub account and applicable Copilot plan.
- `hermes`: configure with `hermes model` or `hermes setup` after installation.
- **Kanarek**: existing private router owns provider keys, fallback and cooldown.
  No provider credentials are copied to Codespaces. A scoped broker must be
  added before Hermes can use the internal Cloudflare Service Binding route.

Codespaces secrets should hold only the minimum scoped credentials required
by a specific tool. Never bulk-import Cloudflare/GitHub Actions secrets, print
secret values, or expose production tokens to an untrusted agent shell.

## Agent roles and first-run configuration

**Three providers, three separate entitlements.** Copilot CLI uses the personal
GitHub Copilot allowance; Antigravity CLI uses the signed-in Google Antigravity
allowance; Hermes uses free-first third-party model providers through the
existing Kanarek router when a restricted external broker is available.
Do **not** configure all three with one shared OpenAI/Gemini API key.
Use one lead agent per task, and optionally a read-only second opinion.
See `.agents/skills/devbox-agent-selection/SKILL.md` for task selection.

### Copilot CLI: GitHub Copilot allowance

```bash
copilot login             # GitHub OAuth device-code flow in Codespaces
copilot                   # In the CLI: /model, /usage, /limits
```

- All Copilot plans, including Copilot Free, support CLI. As of October 2026
  GitHub meters model interactions in **AI Credits**, not the legacy premium
  request count. Free includes a limited monthly allowance with automatic
  model selection; other entitlements vary by the user's GitHub account.
  No OpenAI API key or additional Copilot subscription is assumed.
- Check `/usage` in an interactive session and set a soft per-response guard
  via `/limits set max-ai-credits 30` for exploratory work (30 is the CLI
  minimum; the limit is not a billing-budget substitute).
- Use account OAuth, not the Codespaces-injected `GITHUB_TOKEN`, as the
  intended identity. The injected token is a fallback and can be overridden
  by an explicit GitHub login. Don't set `COPILOT_PROVIDER_BASE_URL` or
  `COPILOT_PROVIDER_API_KEY` unless deliberately switching to BYOK.
- Preserve `AGENTS.md` and `.github/copilot-instructions.md`; don't run
  `copilot init` in this established repo. Keep interactive approvals
  enabled, don't enable global `--allow-all`. Bot-authored GitHub writes
  still go through GPTomek; open PRs as the user.
- GitHub docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli
  and https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing

### Antigravity CLI: account-based Gemini allowance

```bash
agy                       # Sign in to personal Google Account via browser/code
```

- **Use Google Account OAuth for Antigravity**. The CLI can display a
  sign-in URL and a code for a remote terminal; no `GEMINI_API_KEY` is
  needed. Base quota differs by Google AI plan; free account access is
  quota-limited. Review `/usage` and the Antigravity account usage page.
- **Do not set `modelProvider: gemini`** in
  `~/.gemini/antigravity-cli/settings.json`. That setting plus
  `GEMINI_API_KEY` switches to direct Gemini API billing/quota instead
  of the Antigravity account's included allowance.
- Start with account setting **AI Credit Overages = Never**, and with
  `useG1Credits: false` in local settings to avoid optional extra usage.
  Never automatically purchase/enable extra credits.
- Safe non-secret settings example (merge with existing user config;
  do not overwrite it):

```json
{
  "toolPermission": "request-review",
  "artifactReviewPolicy": "asks-for-review",
  "allowNonWorkspaceAccess": false,
  "useG1Credits": false
}
```

- For complex architecture, use planning/artifacts and inspect diffs before
  accepting broad writes; never run competing agents against one checkout.
- Official auth: https://www.antigravity.google/docs/cli/install/
  Plans: https://www.antigravity.google/docs/plans

### Hermes Agent: other providers, ultimately via Kanarek

```bash
hermes config check       # Verify config (no credentials printed)
hermes model              # Select a supported provider interactively
hermes fallback list      # Inspect fallback chain before enabling it
```

- **Target architecture:** Hermes -> scoped, authenticated external broker ->
  existing Kanarek Review OpenAI-compatible `/review-router/v1` service ->
  its provider pool, fallback/cooldowns and free-first policy. The Kanarek
  Worker currently runs behind an internal Cloudflare Service Binding; it
  is **not** a working public API endpoint. Broker work is a separate
  security/transport change; don't expose the internal token or Worker
  publicly as a shortcut.
- After a broker is implemented, set it up with `hermes model` ->
  **Custom endpoint**, its verified HTTPS base URL, an individually scoped
  Devbox token, and an advertised model ID such as
  `kanarek-review-free`. Verify `/models`, streaming, tool-calling and
  error/429 handling before enabling it for agent tasks. A chat-completions
  URL alone does not prove Hermes tool calling works.
- For a manual Hermes named-provider setup, the documented non-secret
  shape below is illustrative only. **No endpoint or token exists yet:**

```yaml
providers:
  kanarek:
    api: "https://REPLACE_WITH_VERIFIED_BROKER_HOST/review-router/v1"
    key_env: KANAREK_DEVBOX_TOKEN
    transport: chat_completions
model:
  provider: kanarek
  default: kanarek-review-free
fallback_providers: []
```

  Never check a real bearer token into this repo. Only after the broker
  exists should `KANAREK_DEVBOX_TOKEN` be issued with read-inference-only
  scope, expiration/rate limits, no paid access and Codespaces secret
  delivery. The broker must keep provider credentials on Cloudflare.
- **Before the broker exists:** use a separately authorized, supported
  provider via `hermes model`, for example Qwen or MiniMax OAuth where
  applicable, or a limited OpenRouter/Ollama Cloud account. Do not copy
  the entire Kanarek credential pool into Codespaces to replicate it.
- The older proposed reference chain (OrcaRouter Free -> Ollama Cloud
  `glm-5.3` -> OpenCode Free DeepSeek -> OpenRouter MiniMax) is **not
  provisioned** and must be revalidated. Prefer fallback *inside Kanarek*
  rather than a second full chain in Hermes; keep Hermes
  `fallback_providers: []` when using Kanarek and paid fallback disabled.
- `~/.hermes/config.yaml` owns non-secret model/provider settings;
  `~/.hermes/.env` or Codespaces secrets provide credentials. Preserve
  the installer-created files; use dangerous-command approvals, secret
  redaction and task-scoped MCP tools. No Codespaces Hermes daemon or
  cron/gateway by default. Repeatable jobs belong in Actions/Pet Dispatcher.
- Docs: https://hermes-agent.nousresearch.com/docs/integrations/providers/
  and https://hermes-agent.nousresearch.com/docs/user-guide/features/fallback-providers/

### Checkpoint

`devbox agents` reports executable and local config-file presence only, not
actual entitlement or secret values. First Codespaces run: log in separately,
inspect credits/quotas, try one small read-only repo task per agent, then one
isolated edit/test, verify provider identity and charges, and stop Codespace.
Never commit `~/.copilot`, `~/.gemini`, `~/.hermes`, or any auth files.

## Remote-first execution and storage policy

Prefer existing external infrastructure over installing or running duplicate
services inside Codespaces. Use the cheapest **appropriate** execution/storage
surface, not an assumed-free endpoint:

1. **GitHub Actions** for CI, schedulers, repeatable scripts and artifacts with
   suitable retention; don't route these jobs through a running Codespace.
2. **Existing managed APIs and remote MCP services** for documentation,
   search, models and specialized work. Reuse Kanarek's provider router and
   current Pet Dispatcher/GPTomek rather than cloning their functionality.
3. **External temporary artifact storage**, only when a provider's existing
   free/included quotas, access controls and expiry policy justify it. Prefer
   direct streaming / one-time links for media; remove transferred artifacts.
4. **Codespaces** only for interactive shells, local-file-dependent tooling,
   browser automation, agents and builds that cannot reasonably run via Actions
   or remote APIs.

Never assume another service is unlimited or free. Check quota, egress costs,
retention, data sensitivity and authentication before transferring files.
Avoid putting private repositories, credentials or authenticated browser
profiles in third-party storage/MCP services.

**Prebuilds:** Disabled by default. If enabled later, scope them **only to
repositories under the personal `trvny/*` account**, after checking the
billing owner and prebuild storage costs. Do not enable prebuilds for
`travnie/*` organizational repositories. The repo does not provision any
prebuild, service, storage bucket or billable infrastructure.

## Dispatch boundaries

- **GitHub Actions**: continue running CI, scheduled jobs, repeatable builds,
  linting and repository maintenance.
- **GPTomek**: existing authenticated GitHub writes, guarded commits/reviews,
  operator transport.
- **Pet Dispatcher**: existing Cloudflare control plane, policies and model
  routing. Its local worker uses Windows MXC and cannot run unchanged on Linux.
- **Devbox**: manually launched Linux tools, browser and agents. Connecting it
  as a Pet Dispatcher execution target requires a separate Linux worker adapter
  with the same task signing, isolation, network and cancellation policy.
  No new dispatcher or provider router should be created.

## Housekeeping

`postStartCommand` runs conservative maintenance whenever the Codespace starts,
but actual cleanup is throttled to **once every seven days**. It never starts a
new machine or runs on a stopped Codespace.

- **Automatic (older than 2 days):** orphaned uBOL installer staging folders
  and temporary `smoke-*` Playwright profiles.
- **Automatic (older than 21 days):** `*.log` files in the Devbox-owned
  `~/.local/share/travny-devbox/logs/` directory.
- **Manual only:** unused uBOL release directories older than 30 days. Keep the
  active version and two newest releases. Retired pre-upgrade `legacy-*`
  folders older than 30 days can also be removed.
- **Manual deep clean:** run `uv cache prune`, `npm cache clean --force`, and
  `python3 -m pip cache purge`. Deep clean requires a separate command
  because it can make the next dependency installation slower.

```bash
devbox maintenance     # Disk free space, cache sizes, eligible files; no deletes
devbox clean           # Safe age-scoped cleanup
devbox clean --deep    # Only when caches are large; avoid concurrent builds
```

All cleanup uses explicit paths under the Devbox-owned directory, ignores
symlinks and leaves `~/workspaces`, repositories, `.git`, active browser
profiles, cookies, Hermes models/state, GitHub authentication, Playwright
browser binaries, Java/Gradle build caches and credentials intact. The manual
report shows the size of common caches without deleting them. We do not use
`docker system prune`, `rm -rf ~/.cache` or indiscriminate workspace cleanup.
The weekly marker lives in `~/.local/share/travny-devbox/.maintenance-last-auto`.
This is best-effort maintenance, not a replacement for deleting unused Codespaces.

## Cost and lifecycle

This configuration requires at least **4 cores / 8 GB**. Choose **8 cores**
on demand in Codespaces machine settings. Higher cores consume the monthly
compute allowance faster. Running and stopped machines both retain storage;
the browser cache and large JDK/build caches can use substantial storage.

Bootstrap runs in `onCreateCommand`, making it eligible for GitHub
Codespaces prebuilds if you later choose to configure them. No prebuild is
enabled by this PR: prebuilds consume extra storage and may affect billing.

Set a Codespaces product budget with **Stop usage when budget limit is reached**
if enabled in GitHub Billing. Prefer a short idle timeout and push work before
the stopped Codespace's retention deadline. No Codespace, paid plan, budget,
secrets or provider connection is provisioned by this repository change.

## Recovery

```bash
bash .devcontainer/setup.sh all
devbox doctor
```

If bootstrap fails, inspect the terminal output and retry the failed target,
not random third-party installers. Credentials and authentication are always
completed by the operator inside their own Codespace.
