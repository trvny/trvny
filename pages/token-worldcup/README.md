# Token Worldcup

[![Quarto CI](https://github.com/trvny/trvny/actions/workflows/quarto.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/quarto.yml) [![Quarto](https://img.shields.io/badge/Quarto-39729E?style=flat-square&logo=quarto&logoColor=white)](https://quarto.org/) [![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

[Token Worldcup](https://travny.pages.dev/teksty/token-worldcup/) measures tokens for **the same facts in 27 languages**. English = 100 per tokenizer. This is tokenizer overhead, **not** a language-quality or model ranking.

## Source of truth

| File | Role |
| --- | --- |
| `token-worldcup.qmd` | **Only maintained corpus** and report source |
| `effort-matrix.qmd` | Model/effort cost matrix |
| `*.html` | Generated Quarto output, checked by CI |
| `recount-openai-tokens.mjs` | `gpt-tokenizer` counts |
| `recount-deepseek-tokens.py` | Pinned official V4.1 tokenizer, SHA-256 verification |
| `recount-claude-tokens.py` + `claude-*-token-counts.json` | Anthropic `count_tokens` measurement and audited snapshots |

## Recount / verify

```sh
cd pages/token-worldcup
npm ci && npm run check:openai
python -m pip install -r requirements.txt
python recount-deepseek-tokens.py --check
python recount-claude-tokens.py --dry-run
```

[Quarto CI](../../.github/workflows/quarto.yml) repeats deterministic recounts and rejects stale HTML. Use verified GPT-5/`o200k_base`, Claude Opus 5.5 and DeepSeek V4.1 counts; other OpenAI reference encodings include `cl100k_base`, `r50k_base`, `o200k_harmony`. Do **not** relabel GPT-5 counts as GPT-6/6.1 without a reproducible authoritative mapping. Prompt/chat-template counts are a future benchmark, not measured here.
