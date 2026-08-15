---
name: gha-pwsh-exit-code-trap
description: "Krok GitHub Actions na pwsh zwraca kod wyjscia TYLKO ostatniej komendy - wczesniejsze porazki (testy, lint) znikaja i job jest zielony"
metadata: 
  node_type: memory
  type: reference
  originSessionId: f2ff24c7-8807-42fb-b3e4-2f6f75856403
  modified: 2026-08-08T12:21:36.882Z
---

Wieloliniowy `run:` w GitHub Actions na **PowerShellu** (domyslna powloka na runnerach
Windows, oraz jawne `shell: pwsh`) konczy sie kodem **ostatniej** komendy. Wszystko
wczesniej moze paść i job dalej jest zielony. Bash ma to samo bez `set -e`, ale tam
przynajmniej `set -e` jest odruchem.

Zmierzone w `trvny/wambridge` 2026-08-05: krok `Test Python package` robil
`python -m unittest ...`, a potem `wambridge-control --help | Out-Null`. Suite
drukowal `FAILED (errors=3)`, a check `Build` raportowal `success` — **od PR #31
(2026-08-02) do #37**. Przez trzy dni zielony ptaszek nie znaczyl nic, w tym na
czterech PR-ach Devina, ktore w rzeczywistosci dokladaly kolejne czerwone testy.

Naprawa (PR #37): jawne `shell: pwsh` + po **kazdej** komendzie
`if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`.

**Jak to wykrywac, zanim ugryzie:** zielony check to nie dowod. `gh run view <id> --log`
i szukac `FAILED|Ran [0-9]+ tests`, jesli cokolwiek w wynikach nie pasuje do lokalnego
przebiegu. To samo sprawdzic w kazdym repo z wieloliniowym `run:` na Windowsie —
`feeds`, `autka`, `kanarek` maja wlasne workflowy.

## Czytanie logu: `--log` zawiera TEZ zrodlo skryptu

**2026-08-08.** `gh run view --log` wypisuje najpierw tresc kroku (`##[group]Run ...`),
a dopiero potem jego wyjscie. Grep po tekscie z `echo` znajduje wiec **obie galezie
if/else naraz** i mozna sobie „udowodnic" dowolna teze. W `feeds` jeden przebieg
zwrocil rownoczesnie „Restored cache from R2", „No usable R2 snapshot" i „Cloudflare
credentials unavailable" — trzy wykluczajace sie komunikaty z jednego kroku.

Rozstrzyga **forma wyrenderowana**, nie tekst zrodlowy:
- `echo "::warning::X"` → w logu jako `##[warning]X`
- zwykly `echo "X"` → linia z sygnatura czasowa `2026-08-08T09:18:38.1229939Z X`

Wiec grepowac `^.*[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z <tekst>` albo `##\[warning\]`,
nigdy samego `<tekst>`. Uwaga tez: `gh run view --log` potrafi zwracac `UNKNOWN STEP`
zamiast nazw krokow, wiec filtrowanie po nazwie kroku cicho daje zero wynikow —
wtedy isc po `repos/{o}/{r}/actions/runs/{id}/jobs` i czytac `conclusion` per krok.
Ale `conclusion: success` na kroku z galezia `else` **nic nie dowodzi**, bo obie
galezie koncza sie zerem.

Kontekst projektu: [[wambridge-project]]. Kierunek synchronizacji: [[git-sync-direction]].
