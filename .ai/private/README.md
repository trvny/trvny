# Repo-local overlay

Downstream overlays for public `.ai/core`: non-secret personal,
project-specific, or provider-specific material. Reusable material lives in core.

`private` is an overlay label, not a confidentiality boundary. This directory
is publicly tracked: publish-safe material only. Keep secrets, private endpoints,
private paths, and private Git history out of Git.

```text
.ai/private/
├── personalities/  tool-neutral opt-in voices and instruction sets
├── openai/          OpenAI/Gremlin-specific overlay material
└── claude/          Claude-specific counterparts of the core's Claude material
```

You may copy or adapt provider-neutral voices from `personalities/`. Other
directories are named per tool, mirroring core's provider defaults. Add a
provider directory when needed; do not mix one tool's material into another's.

Read this active material; filter nothing here on a normal pass. Historical
storage lives outside this tree in `.ai/backups/`.

## Direction of changes

Reusable profiles, schemas, tools, templates, styles, instructions, provider
defaults and intentionally public skills belong in `trvny/.ai`. Non-secret
personal, workflow, project-specific, or provider-specific overlays belong here.

To customize a public core file, add an overlay or change the public source;
do not copy it here.
