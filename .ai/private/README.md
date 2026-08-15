# Private overlay

The private side of what `.ai/core` provides publicly. The core carries what is
reusable and safe to publish; this carries the same kinds of thing where they are
personal, project-specific, or simply not for a public repository.

```text
.ai/private/
└── claude/     Claude-specific counterparts of the core's Claude material
```

One directory per tool, named after it, mirroring how the core keeps `.claude/`
and `.codex/` reference defaults side by side. Add `codex/` or `gemini/` the same
way when there is something to put in them — do not pile another tool's material
into an existing directory.

This is active material: read it. Historical storage lives in `.ai/backups/` and
is deliberately outside this tree, so nothing here needs to be filtered out on a
normal pass.

## Direction of changes

Reusable profiles, schemas, tools, templates, styles, instructions, provider
defaults and intentionally public skills belong in `trvny/.ai`. Personal
identity, private workflow and project-specific material belong here.

Do not copy a public core file here to customize it. Add an overlay, or change
the public source.
