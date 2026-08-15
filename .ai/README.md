# Private `.ai` overlay


```text
.ai/
├── core/          public submodule -> https://github.com/trvny/.ai
├── profile.yaml   private profile overlay
└── private/       personal and project material (backups/ is historical)
```

Initialize the pinned public core after cloning:

```bash
git submodule update --init .ai/core
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

Later layers win. The private profile deliberately pins personal communication and collaboration choices so a future generic-default change does not silently alter them. Reusable schemas, tools, templates, provider defaults, and public skills still have a single source of truth in the public core.

The referenced merge tool, renderer, base profile, and schema are present in the pinned public-core commit. Current CI does not read `.ai/core`; any future workflow that does must enable submodule checkout first.

## Direction of changes

- reusable profiles, schemas, tools, templates, styles, instructions, provider defaults, or intentionally public skills -> `trvny/.ai`
- personal identity, private workflow, project-specific material, backups, or archives -> this repository

Do not copy a public core file here to customize it. Add an overlay or change the public source instead.

Material under `.ai/private/` may be active; see `.ai/private/README.md`. The exception is `.ai/private/backups/`, which is historical storage and is not read on a normal pass.
