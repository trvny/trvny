---
name: merge-conflict-marker-check
description: "po KAZDYM rozwiazaniu konfliktu skryptem przegrep calego drzewa za markerami - 08.08.2026 wpuscilem <<<<<<< HEAD do commita, przeszlo CI i runde review"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e4784942-dfbe-46e5-83f5-6c9f732ff18d
  modified: 2026-08-08T18:43:12.312Z
---

Po rozwiazaniu konfliktu scalania **automatem** (skrypt, `sed`, regex) **zawsze** przegrepowac
calosc za `<<<<<<<`, `=======`, `>>>>>>>` — nie tylko pliki, ktore wymienil git.

**Why:** 2026-08-08 w `trvny/wambridge` rozwiazywalem konflikt skryptem po dwoch plikach z
komunikatu `git merge`. Trzeci plik (`docs/FOOBAR_PLUGIN.md`) mial markery z **wczesniejszego**
scalenia na tej samej galezi. Poszly do commita, przeszly **build, CodeQL i pelna runde
review**, i zlapali to dopiero recenzenci przy nastepnym przebiegu. Zadne z automatycznych
zabezpieczen nie patrzy na markery w markdownie.

**How to apply:** po `git add -A`, przed `git commit`:

```
git diff --cached -U0 | Select-String -Pattern "^\+(<<<<<<<|=======|>>>>>>>)"
```

albo prosto `Select-String -Path <drzewo> -Pattern "^(<<<<<<<|>>>>>>>)"`. W repo, gdzie to
sie powtarza, dolozyc test przechodzacy po plikach tekstowych — tak zrobione w wambridge
(`test_no_conflict_markers_in_tracked_text`).

Drugi wniosek z tej samej wtopy: **`git merge` wypisuje konflikty biezacego scalenia, nie
stan drzewa.** Plik moze byc brudny po czyms wczesniejszym i nie pojawic sie na tej liscie.
