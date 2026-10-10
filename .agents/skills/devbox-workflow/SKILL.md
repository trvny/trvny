---
name: devbox-workflow
description: Use when tasks require tools, builds, browser automation or local agents in the shared GitHub Codespaces Devbox. Prefer GitHub Actions for repeatable jobs and existing GPTomek/Pet Dispatcher control surfaces.
---

# Devbox workflow

- Run `devbox doctor` before assuming optional tools installed.
- Follow the remote-first execution and personal-only prebuild policy in `.devcontainer/README.md` (the source of truth for resource choices).
- Clone project with `devbox clone owner/repo`; read nearest `AGENTS.md`.
- Core tools (git, gh, Python, JDK, Node, jq, rg, fd, 7z, imagemagick) install with `devbox install base`.
- Optional Android with `devbox install android`, full SDK with `devbox install android-sdk`; Cloud CLI with `devbox install cloud`.
- Browser with uBOL through `devbox browser URL` or `launchWithUbol()` in `.devcontainer/browser.mjs`.
- Review disk with `devbox maintenance`; manual cleanup `devbox clean`.
- Never copy provider secrets out of Kanarek or expose production credentials in agent env.
- Never create another router, task queue or memory store when existing Kanarek/Pet Dispatcher owns the concern.
