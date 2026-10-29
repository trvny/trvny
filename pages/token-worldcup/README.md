# Token Worldcup

Token Worldcup compares how much equivalent text costs to tokenize across 27
natural-language versions of the same small set of facts. English is the
`100` anchor for each tokenizer, so the page shows both raw token counts and
relative overhead.

It is a tokenizer benchmark, not a language-quality or model-intelligence
ranking. The corpus stays the same while the tokenizer changes.

## Maintained sources

| File | Role |
| --- | --- |
| `token-worldcup.qmd` | Maintained corpus, UI and benchmark source |
| `token-worldcup.html` | Generated Quarto output |
| `effort-matrix.qmd` | Maintained model/effort cost matrix |
| `recount-openai-tokens.mjs` | GPT/open encoding recounts through `gpt-tokenizer` |
| `recount-deepseek-tokens.py` | DeepSeek V4.1 recount from a pinned official tokenizer |
| `recount-claude-tokens.py` | Claude recount through the model's token-counting API |
| `claude-*-token-counts.json` | Auditable raw Claude measurements from Anthropic `count_tokens` |

The corpus lives only in `token-worldcup.qmd`. Recount tools read it directly
instead of maintaining a second copy.

## Current comparison

The main page currently exposes:

- **GPT-5** through the model-specific `gpt-tokenizer/model/gpt-5` module
  (`o200k_base` for ordinary text).
- **Claude Opus 5.5** through Anthropic `count_tokens`, or OpenRouter
  `usage.input_tokens` as a fallback. Fixed request framing is measured and
  subtracted; raw values remain in JSON.
- **DeepSeek V4.1** through the official V4.1 `tokenizer.json`, pinned to a
  DeepSeek revision and verified by SHA-256.
- **cl100k_base**, **r50k_base** and **o200k_harmony** as additional OpenAI/GPT
  encoding reference points.

Model names only move forward when the corresponding tokenization can be
reproduced from an authoritative source. A newer model announcement by itself
is not enough to relabel older counts.

## Recount and checks

From this directory:

```bash
npm ci
npm run check:openai

python -m pip install -r requirements.txt
python recount-deepseek-tokens.py --check
python recount-claude-tokens.py --dry-run
```

The committed Opus 5.5 snapshot is a direct Anthropic `count_tokens` recount.
The previous OpenRouter measurement matched all 27 rows and the same 8-token
framing overhead, so OpenRouter remains an explicit fallback only.

CI repeats the deterministic OpenAI and DeepSeek recount checks, renders the
Quarto reports, and fails if committed HTML drifts from the maintained QMD.

## Tracking newer models

GPT-6 and GPT-6.1 are tracked, but the current public OpenAI tokenizer tooling
does not yet expose an authoritative `gpt-6*` model-to-encoding mapping.
Until that exists, the Cup keeps the verified GPT-5/`o200k_base` baseline
instead of putting a GPT-6 label on unverified counts.

A useful next benchmark is **full prompt/chat-template tokenization**, not only
plain text. That should include model-specific framing, special tokens and
reasoning-history representation. DeepSeek V4 and V4.1 produced identical
plain-text counts on all 27 current samples, but their special-token handling
can still differ, so the prompt-level benchmark may reveal changes that the
current corpus cannot.
