# Backups

Historical storage. Nothing here is active configuration, and nothing should
search this tree on a normal pass — open it only when you are after something
specific and expect to find it here.

```text
backups/
├── archive/       superseded instructions, profiles, schema and styles
├── skills/        retired and project-specific skill bundles
└── llm-wiki.zip   wiki snapshot
```

`archive/` holds files replaced by the public core or by `.ai/profile.yaml`.
They are kept for reference and migration, not for use. Do not edit an archived
copy of a public-core file and synchronize it back — reusable changes go
directly to `trvny/.ai`.

`skills/` holds skill bundles that are no longer wired into anything, plus ones
that only ever made sense for a single project. Public, reusable skills belong
in `trvny/.ai` instead.
