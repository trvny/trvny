# AGENTS.md

> na spokojnie

This repository is a private command center/monorepo. Before editing, identify
which existing home owns the task. Prefer improving that home over creating a
parallel structure.

## Repo map

Use this as the first routing pass. The root `README.md` has the human-facing
project map; this section is the agent-facing shortcut and should stay in sync
when major homes move.

| If the task is about | Go to | Notes |
|---|---|---|
| QR codes, barcodes, scanners, Codebench | `codebench/` | Browser/Worker tool. Read `codebench/README.md` before broad changes. |
| IPTV, radio, HLS, M3U/M3U8, XMLTV, Streambench | `streambench/` | Media testing/organizing/player workshop. Read `streambench/README.md`. |
| Weather, IMGW alerts, Kościelec, Chrzanów | `weather-feed/` | Multi-source weather Worker exposing Atom/JSON. |
| Aggregate service health / MCP status | `mcp/status-mcp/` | Health checks for selected external projects/services. |
| GitHub Apps, GPT Actions, Gremlin operator, Kanarek Companion, GPT omek | `gh-apps/` | `kanarek-companion/` is the shared Cloudflare Worker/runtime. `gptomek/` documents/configures the bot identity; it reuses the Companion Worker rather than running a second backend. |
| Gremlin runtime policy, style profile, operator roadmap | `.ai/private/openai/` | Private OpenAI/Custom GPT overlay. Runtime safety policy and model style are separate concerns. |
| Claude-local notes and learned repo traps | `.ai/private/claude/` | Private Claude overlay and working memory. |
| Shared AI styles/instructions/profile composition | `.ai/` | Public `.ai/core` submodule plus private overlays in this repo. |
| Playlists, small configs, helper feeds, quotes, miscellaneous drawers | `stuff/` | Shared loose material that does not justify a separate project. |
| Licenses and third-party notices | `docs/` and repository root | Keep factual/legal files boring and accurate. |

For `gh-apps/` work, do not assume names imply separate runtimes. In particular,
GPTomek and Kanarek Companion share the `gh-apps/kanarek-companion/` Worker.
Check `gh-apps/README.md` and the component README before changing auth,
webhooks, Actions, OAuth, bot identity, release, maintenance or operator code.

## Read `.ai` first

Shared context lives in `.ai/`. Read only the layers relevant to the task, with
these common entry points:

1. `.ai/private/openai/gremlin-policy.json`,
   `.ic/private/openai/gremlin-profile.yaml` and, when changing the operator
   stack, `.ai/private/openai/gremlin-roadmap.md` — private Gremlin runtime
   policy, dedicated style profile and implementation checkpoint.
2. `.ai/private/claude/memory/` — working notes from the author's local store:
   habits, GitHub conventions, CI traps. This is the part a clone cannot get any
   other way, and the part most likely to save a wasted round. You can add to it:
   `memory/field-notes/` is written here rather than exported, so a finding that
   cost you real work does not have to cost the next session the same.
3. `.ai/core/instructions/` and `.ai/core/styles/` — shared communication
   defaults from the public core, a pinned submodule of `trvny/.ai`.
4. `.ai/profile.yaml` — the general private profile overlay on the core's base
   profile. Do not treat it as the Gremlin-specific profile.

**Precedence does not follow the reading order above.** When two layers
disagree, the more specific one wins: this file beats anything in `.ai/`, and
everything private (`.ai/private/`, `.ai/profile.yaml`) beats the public core.
Provider/task-specific private material beats a general private default for that
provider/task.

Skip the rest of `.ai/core` unless you are changing the core itself. Its
`AGENTS.md` governs maintenance of *that* repository, not work in this one, and
it says outright that its `.claude/` and `.codex/` defaults are not active in
repositories consuming it as a submodule. `.ai/README.md` covers composing the
style profile and which direction a change belongs in.

A fresh clone leaves `.ai/core` empty because it is a submodule. The
`SessionStart` hook initializes it; without that hook run
`git submodule update --init .ai/core` before relying on anything above.

`.ai/backups/` is historical storage — not instructions, and not something to
search on a normal pass. Go in only when you are after something specific and
expect to find it there.

## GitHub

- Prefer one logical change per pull request; truly trivial, low-risk fixes can
  go directly to `main`.
- Keep pull-request descriptions, comments, and changelogs brief.

## Code review rules

- Do not comment on README-only, documentation-only, changelog, formatting, or
  cosmetic changes unless they introduce a factual error or break
  generated/validated content.
