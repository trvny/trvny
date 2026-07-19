# LLM style documents backup

To jest dokładny backup plików przygotowanych wcześniej w rozmowie:

- `styles-pl.md`
- `instructions-pl.md`
- `styles-en.md`
- `instructions-en.md`
- `styles-schema.md`
- `style-profile.schema.json`

Archiwum jest zapisane jako Base64 w czterech częściach, ponieważ connector GitHub zapisuje pliki tekstowe, a nie binarne załączniki.

## Odtworzenie

Z katalogu głównego repozytorium:

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

Archiwum zawiera wyłącznie wymienione dokumenty i schemat. Nie zawiera sekretów ani plików środowiskowych.
