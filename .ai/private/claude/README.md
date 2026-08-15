# Claude

Private counterparts of the Claude material the core keeps in `.ai/core/.claude/`.
What lives here is personal or project-specific, so it cannot go to the public
core, but it is still active configuration and context.

```text
claude/
├── memory/         working notes exported from the local memory store
└── delegation.md   checklist for writing a subagent task prompt
```

`memory/` is the part a remote session cannot get any other way: the maintained
store sits at `~/.claude/memory` on the author's machine and is not reachable
from a clone. Its own README states the export contract — the source is
authoritative, files here are copies, and a fix belongs at the source.
