---
name: python314-syntax-vs-runner-python3
description: "except A, B: jest LEGALNE w Pythonie 3.14 (PEP 758) — SyntaxError w logach CI nie znaczy zepsuty kod, tylko ze krok odpalil golym python3 runnera zamiast uv run"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2233a275-a8ec-4c34-99c6-3dd9b73abaae
  modified: 2026-08-14T21:19:30.406Z
---

`except ValueError, TypeError:` **kompiluje sie w Pythonie 3.14** — PEP 758 dopuscil nawiasy
opcjonalnie. To nie jest relikt Pythona 2. Lokalny `python -V` tutaj to 3.14.7, wiec
`py_compile` przechodzi bez slowa.

Runnery GitHuba maja w `python3` wersje **starsza** (3.12 na `ubuntu-latest` w 08.2026).
Dlatego krok workflowa odpalony jako `python3 skrypt.py` wywala:

```
SyntaxError: multiple exception types must be parenthesized
```

na pliku, ktory jest **calkowicie poprawny** dla projektu z `requires-python = ">=3.14"`.

**Why:** komunikat wskazuje palcem na kod i az sie prosi, zeby "naprawic" skladnie w repo.
To bylaby zla poprawka — zepsuty jest krok CI, nie plik. W feedseek zjadlo to caly krok
`Sync legacy Kanarek feed paths` i mirror kompatybilnosci przestal sie odswiezac po cichu,
bo krok mial `continue-on-error: true`.

**How to apply:** w repo z `requires-python >= 3.14` kazdy krok, ktory importuje kod projektu,
musi isc przez `uv run --locked`, nigdy przez `python3`. Bare `python3` jest OK **wylacznie**
dla skryptow na czystej stdlib (u nas: `site/build_site.py`, `site/make_opml.py`,
`tools/restore_cache_archive.py`, inline'y `python3 -c`). Szybki test przed dotknieciem czegokolwiek:

```
grep -rn "python3 " .github/workflows/ | grep -v "python3 -c"
```

i dla kazdego trafienia sprawdz `^import|^from` w tym pliku — jesli ciagnie `models`, `utils`
albo cokolwiek z `feed_generators/`, to potrzebuje `uv run`. Powiazane: [[feedseek-local-dev-env]].

## Inwariant, ktory to domyka (feedseek, 14.08.2026)

Nie „poprawiaj skladni", tylko usun drugi interpreter. W `trvny/feedseek` kazdy workflow instaluje
uv i wszystko idzie przez `uv run`; sprawdzian to:

```
grep -rn python3 .github/workflows/     # ma byc pusto
```

Jedyny dozwolony wyjatek to hook, ktory **bootstrapuje samo uv** — ten musi uzyc systemowego
pythona, bo uv jeszcze nie ma. Snippety bez zaleznosci ida przez `uv run --no-project`.

Uwaga na kolejnosc krokow: jesli cos odpala Pythona **przed** `setup-uv`, przeniesienie
`setup-uv` zaraz za `checkout` jest tansze niz zostawianie tam golego `python3`.

Przy okazji tej samej zmiany ustalona regula cache'u uv: **`enable-cache: false` wszedzie, gdzie
job publikuje artefakt albo pushuje z prawem zapisu** (wpis cache'u zapisany z galezi jest
odtwarzalny w uprzywilejowanym runie). Zmierzony koszt rezygnacji: 4 s przy 12 min 41 s samego
generowania, czyli zaden. Cache zostal tylko w `mega-linter.yml` — `permissions: {}` i
`persist-credentials: false`.
