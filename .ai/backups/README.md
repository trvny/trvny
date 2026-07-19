# LLM style documents backup

- `styles-pl.md`
- `instructions-pl.md`
- `styles-en.md`
- `instructions-en.md`
- `styles-schema.md`
- `style-profile.schema.json`

## Odtworzenie

```bash
cat .ai/backups/llm-styles-backup.tar.gz.b64.part* \
  | base64 --decode \
  > /tmp/llm-styles-backup.tar.gz

mkdir -p .ai/backups/restored

tar -xzf /tmp/llm-styles-backup.tar.gz \
  -C .ai/backups/restored
```

Wynik:

```text
.ai/backups/restored/
├── styles-pl.md
├── instructions-pl.md
├── styles-en.md
├── instructions-en.md
├── styles-schema.md
└── style-profile.schema.json
```

## Szybka weryfikacja

```bash
tar -tzf /tmp/llm-styles-backup.tar.gz
```
