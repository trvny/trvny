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
Copilot CLI, Hermes CLI, Playwright Chromium and official uBlock Origin Lite.
The Hermes installer skips its separate browser download to avoid duplication.

```bash
devbox doctor
devbox clone trvny/feedseek
devbox clone travnie/aistee
devbox browser https://example.com /tmp/example.png
devbox install browser
devbox install hermes
```

Other repositories are cloned into `~/workspaces/<owner>/<repo>`. Their own
instructions and build requirements still apply. The Devbox does not copy
project-specific scripts or create duplicate CI.

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
