---
name: memory-state-vs-durable
description: "Nie zapisuj w pamięci żywego stanu (PR-y, HEAD, listy repo, zawartość ini) jako gołych faktów — to główne źródło zgnilizny; datuj i pisz, czym to sprawdzić."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 67c78982-400c-4a1c-b90e-4bc98007d6d3
  modified: 2026-08-03T10:18:15.395Z
---

Wpis w pamięci starzeje się dokładnie tak szybko, jak rzecz, którą opisuje. **Żywy stan
zewnętrzny — status PR-a, SHA `main`, lista otwartych PR-ów, zawartość katalogu, klucze
w pliku konfiguracyjnym — nie jest faktem trwałym** i nie wolno go zapisywać jak fakt.

**Why:** audyt pamięci z 2026-08-03 dał 10 znalezisk, z czego **6 to dokładnie ten wzorzec**:
`feeds` PR #140 opisany jako „decyzja wisi", choć był zmergowany **8 h przed powstaniem wpisu**
(czyli wpis był fałszywy już w chwili zapisu); hak indeksu mówiący „PR #21 gotowy do scalenia",
gdy własny plik docelowy mówił „ZMERGOWANY"; ostrzeżenie o `format=mp3` w ini, którego w ini
nie było; lista repo z nieistniejącym `ext-apps` i bez `wambridge`; „zbumpuj autka CI na 24",
gdy bump był zrobiony, a wskazany plik już nie istniał. Żadne z tego nie wymagało śledztwa —
jedno wywołanie `gh` albo `Test-Path` rozstrzygało w sekundę.

**How to apply:**

- Zanim zapiszesz stan zewnętrzny, zapytaj: czy to prawda **o rzeczy**, czy tylko **o chwili**?
  Trwałe: przyczyna błędu, obalona hipoteza, decyzja użytkownika i jej powód, pułapka
  narzędzia. Nietrwałe: status PR-a, HEAD, co jest otwarte, co leży w katalogu.
- Jeśli stan naprawdę musi wejść (bo bez niego wpis nie ma sensu) — **datuj go i dopisz
  komendę, którą się go odświeża**, np. „sprawdzone 2026-08-03 przez `gh pr view N`".
  Wtedy czytelnik wie, że ma zweryfikować, zamiast wierzyć.
- Zamiast „X wisi i czeka na decyzję" pisz, **czym X jest** — to się nie przeterminuje.
- Przy pisaniu wpisu o czymś, co właśnie sam zrobiłeś, sprawdź stan **na koniec** tury,
  nie przepisuj go z jej początku. Tak powstał wpis o #140.
- To samo dotyczy haka w `MEMORY.md`: hak i opis pliku muszą mówić to samo, bo hak jest
  jedyną rzeczą ładowaną przy starcie.

Patrz [[git-sync-direction]] (ta sama zasada dla repo: GitHub jest źródłem prawdy, nie
lokalny klon ani pamięć) i [[feedback-measure-before-theorising]] (sonda rozstrzyga, nie
lektura). Audyt uruchamia skill `memory-hygiene`.
