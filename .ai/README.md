# Private `.ai` overlay

This repository no longer carries a second copy of the reusable AI core.

```text
.ai/
├── core/          public submodule -> https://github.com/trvny/.ai
├── profile.yaml   private partial overlay
└── private/       backups and archived personal/project material
```

## Compose the effective profile

```bash
python .ai/core/tools/merge_profile.py \
  .ai/core/profiles/default.yaml \
  .ai/profile.yaml \
  --schema .ai/core/schema/style-profile.schema.json \
  --output .ai/generated/profile.yaml
```

Render the same stack directly into instructions:

```bash
python .ai/core/tools/render_profile.py \
  .ai/core/profiles/default.yaml \
  .ai/profile.yaml \
  --schema .ai/core/schema/style-profile.schema.json \
  --output .ai/generated/instructions.txt
```

Later layers win. `profile.yaml` therefore contains only private differences from the public default.

## Direction of changes

- reusable profiles, schemas, tools, templates, styles, instructions, provider defaults, or intentionally public skills -> `trvny/.ai`
- personal identity, private workflow, project-specific material, backups, or archives -> this repository

Do not copy a public core file here to customize it. Add an overlay or change the public source instead.

Material under `.ai/private/` is backup/archive storage and is not active configuration unless explicitly loaded.
