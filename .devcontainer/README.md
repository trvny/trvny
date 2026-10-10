# Codespaces AI Devbox

Reusable, on-demand development machine. Actions remain the default for CI,
builds, schedules and repeatable automation. Use Devbox for interactive work,
agent sessions, browser investigations and tasks needing a persistent shell.

## Launch

1. Open `trvny/trvny` on GitHub: **Code → Codespaces → Create codespace**.
2. Select the `feat/codespaces-ai-devbox` branch until this PR merges.
3. Select **4 cores / 8 GB**. Switch to **8 cores / 16 GB** only for heavy builds.
4. Wait for `postCreateCommand` to finish. In the terminal: `devbox doctor`.

The universal Linux image supplies Bash, Git, GitHub CLI, Python, Node, Java,
Maven, Gradle and other common runtimes. Setup adds uv, Antigravity CLI (`agy`),
Copilot CLI, Hermes CLI, Playwright Chromium, official uBlock Origin Lite, yt-dlp and ffmpeg.
The Hermes installer skips its separate browser download to avoid duplication.

```bash
devbox doctor
devbox clone trvny/feedseek
devbox clone travnie/aistee
devbox browser https://example.com /tmp/example.png
devbox install browser
devbox install hermes
devbox download "https://www.youtube.com/watch?v=EXAMPLE"   # One video, max 1080p
devbox download --audio "https://www.youtube.com/watch?v=EXAMPLE" # MP3
devbox download --best "https://www.youtube.com/watch?v=EXAMPLE"  # Best quality
devbox files                                           # Files ready to collect
devbox maintenance        # Read-only disk/cache report
devbox clean              # Prune old Devbox-owned temp files
devbox clean --deep       # Also prune package-manager caches
```

Other repositories are cloned into `~/workspaces/<owner>/<repo>`. Their own
instructions and build requirements still apply. The Devbox does not copy
project-specific scripts or create duplicate CI.

## Media downloads (yt-dlp)

Use `devbox download URL` (alias `devbox fetch URL`) for a single item,
not an entire playlist. `--audio` extracts MP3; `--best` removes the default
1080p video cap. The helper uses yt-dlp and ffmpeg/ffprobe. If missing,
run `devbox install media`. It checks disk space before starting and requests
a 2 GiB per-download-item limit from yt-dlp. It does not bypass DRM, set
cookies, access your browser sessions, or download playlists automatically.

**Pick up the file from your phone:** in the Codespaces browser editor,
open the **Explorer → downloads** folder at the repository root, open the
file's context menu (**right-click**, or long-press where supported), and
select **Download**. On Android you may need the browser's desktop-site mode.
Or use `devbox files` to show exact file names and sizes.

Media lives only in the ignored repository-root `downloads/` folder.
Never commit it or upload it to GitHub Releases. **Delete files yourself after
transfer** via the Explorer; automatic maintenance deliberately does not touch
this folder. Files use persistent Codespaces storage, including while stopped.
Downloads may fail on sites blocking datacenter IPs or requiring authentication.
Only save media you have permission to download.

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
