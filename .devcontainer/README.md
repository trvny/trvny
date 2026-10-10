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
