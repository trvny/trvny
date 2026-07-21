# GitHub instruction sources

This directory is the maintained source of truth for GitHub-specific AI
instructions.

GitHub products discover repository instructions only at specific paths under
`.github/`, so generated copies remain there for compatibility.

## Canonical sources

```text
.ai/github/
├── copilot-instructions.md
├── agents/
│   └── trvny-maintainer.md
└── instructions/
    ├── cloudflare.instructions.md
    └── microsoft.instructions.md
```

## Generated discovery files

```text
.github/
├── copilot-instructions.md
├── agents/
│   └── trvny-maintainer.md
└── instructions/
    ├── cloudflare.instructions.md
    └── microsoft.instructions.md
```

Do not edit the generated copies directly. Synchronize them with:

```bash
python .ai/tools/sync_github_instructions.py
```

Check for drift without writing files:

```bash
python .ai/tools/sync_github_instructions.py --check
```

This avoids relying on symlinks or provider-specific include syntax, which is
not consistently supported across Copilot Chat, code review, cloud agents,
CLI, and IDE integrations.
