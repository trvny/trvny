# Repo-local overlay

The downstream side of what `.ai/core` provides publicly. The core carries what
is reusable; this directory carries non-secret personal, project-specific, or
provider-specific overlays.

`private` is a path/overlay label, not a confidentiality boundary. This
directory is tracked in the public repository and must contain only material
safe to publish. Secrets, private endpoints, private paths, and private Git
history stay out of Git.

```text
.ai/private/
├── personalities/  tool-neutral opt-in voices and instruction sets
├── openai/          OpenAI/Gremlin-specific overlay material
└── claude/          Claude-specific counterparts of the core's Claude material
```

`personalities/` contains provider-neutral voices that can be copied or adapted
where needed. Other directories are split per tool, named after it, and mirror
how the core keeps provider defaults side by side. Add another provider
directory the same way when there is something to put in it; do not pile one
tool's material into another directory.

This is active material: read it. Historical storage lives in `.ai/backups/` and
is deliberately outside this tree, so nothing here needs to be filtered out on a
normal pass.

## Direction of changes

Reusable profiles, schemas, tools, templates, styles, instructions, provider
defaults and intentionally public skills belong in `trvny/.ai`. Non-secret
personal, workflow, project-specific, or provider-specific overlays belong here.

Do not copy a public core file here to customize it. Add an overlay, or change
the public source.
