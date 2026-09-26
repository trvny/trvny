"""Point the main Claude comparison at Opus 5.5 (same counts as Opus 5, framing 8)."""
import pathlib

p = pathlib.Path("token-worldcup/token-worldcup.qmd")
s = p.read_text(encoding="utf-8")
REPLACEMENTS = [
    ('i zmierzony Claude Opus 5."', 'i zmierzony Claude Opus 5.5."'),
    ('Główne porównanie to GPT-5 i Claude Opus 5;', 'Główne porównanie to GPT-5 i Claude Opus 5.5;'),
    ('Pomiar Claude w <a href="claude-token-counts.json"><code>claude-token-counts.json</code></a> pochodzi z natywnego licznika wejścia przez OpenRouter <code>/v1/messages</code>; stały framing 6 tokenów jest odejmowany.',
     'Pomiar Claude Opus 5.5 w <a href="claude-opus-5-5-token-counts.json"><code>claude-opus-5-5-token-counts.json</code></a> pochodzi z natywnego licznika wejścia przez OpenRouter <code>/v1/messages</code>; stały framing 8 tokenów jest odejmowany. Opus 5 daje identyczne liczby we wszystkich 27 językach (różni się tylko framingiem: 6), więc tokenizer się nie zmienił; jego pomiar został w <a href="claude-token-counts.json"><code>claude-token-counts.json</code></a>.'),
    ('claudeLabel="Claude Opus 5",claudeFraming=6', 'claudeLabel="Claude Opus 5.5",claudeFraming=8'),
    ("Claude Opus 5 jest zmierzony przez", "Claude Opus 5.5 jest zmierzony przez"),
    ("Surowy wynik zostaje w `),codeLink('claude-token-counts.json','claude-token-counts.json'),txt('.'));",
     "Surowy wynik zostaje w `),codeLink('claude-opus-5-5-token-counts.json','claude-opus-5-5-token-counts.json'),txt('. Opus 5 daje identyczne liczby we wszystkich językach (framing 6), więc tokenizer się nie zmienił; jego pomiar jest w '),codeLink('claude-token-counts.json','claude-token-counts.json'),txt('.'));"),
]
for old, new in REPLACEMENTS:
    if s.count(old) != 1:
        raise SystemExit(f"expected exactly one match for: {old[:60]!r}")
    s = s.replace(old, new)
p.write_text(s, encoding="utf-8")
print("token-worldcup.qmd updated")
