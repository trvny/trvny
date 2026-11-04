# Claude

Private counterparts of the Claude material the core keeps in `.ai/core/.claude/`.
What lives here is personal or project-specific, so it cannot go to the public
core, but it is still active configuration and context.

```text
claude/
├── hooks/
│   └── github-badge.py Claude Code cloud: badge on GitHub posts (MCP hook + gh shim)
├── memory/
│   ├── *.md            notes exported down from the local memory store
│   └── field-notes/    notes written up, here, by whoever worked in this repo
└── delegation.md       checklist for writing a subagent task prompt
```

`memory/` is the part a session away from the author's machine cannot get any
other way: the maintained store sits at `~/.claude/memory` and is not reachable
from a clone.

It works in two directions, and its own README is the contract. The notes
directly in `memory/` are **exported down** from that store: copies, so a fix
belongs at the source rather than here. `memory/field-notes/` is **written up**,
in this repository, by whoever worked in it — including delegated agents and
cold sessions with no access to the local machine. No file is authored from both
sides, which is what keeps either direction from drifting.

## GitHub badge (cloud)

`hooks/github-badge.py` puts a Claude Code badge on top of GitHub posts from
cloud sessions; claude.ai posts get theirs from Claudiusz
(`gh-apps/claudiusz/src/badge.ts`). Shared markers: `<!-- claude-badge -->`
(already badged), `<!-- no-badge -->` (post written as the user, no badge).

Cloud environment setup script, after `~/.claude/settings.json` is written
(`install` symlinks `gh` into `~/.local/bin`, ahead of the real one, and adds the
`PreToolUse` entry to settings, idempotently):

```bash
B=~/.claude/hooks/github-badge.py
curl -fsSL -o $B https://raw.githubusercontent.com/trvny/trvny/main/.ai/private/claude/hooks/github-badge.py \
  && python3 $B install || echo "github-badge: install failed"
```
