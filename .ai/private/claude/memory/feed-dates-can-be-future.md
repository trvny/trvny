---
name: feed-dates-can-be-future
description: "Data wpisu w feedzie z przyszlosci NIE jest sama w sobie bledem — prognozy i zapowiedzi maja ja celowo; nie filtruj hurtem, przycinaj klucz sortowania"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2233a275-a8ec-4c34-99c6-3dd9b73abaae
  modified: 2026-08-14T23:45:14.337Z
---

Rozpoznanie z 14.08.2026: znalazlem w `feed_govpl_news.xml` wpis z data `2028-08-12` i zaproponowalem
odrzucanie dat z przyszlosci. **Odrzucone przez uzytkownika, slusznie:** czesc feedow ma je
*celowo* — prognozy pogody (`open_meteo`, `openweather`, `visualcrossing`, `imgw`), zapowiedzi
swiat i zaplanowanych wydarzen. Filtr „ts > now → wytnij" skasowalby prawdziwa tresc.

**Why:** jeden zepsuty wpis jest widoczny i kusi do napisania reguly globalnej. Ale „data
w przyszlosci" laczy dwa rozne zjawiska — zaplanowana publikacje i literowke w zrodle — a jedno
z nich jest poprawna trescia. Reguly nie da sie oprzec na samym znaku roznicy.

**How to apply:** jesli problemem jest **kolejnosc** (jeden wpis okupuje gore listy), napraw
kolejnosc, nie zbior: sortuj po `min(ts, now)`. Wpis zostaje widoczny, ale nie wyprzedza wszystkiego
na dwa lata. Tak zrobione w panelu na `travny.pages.dev` (`tvpi`, commit `c249e68`).

Jesli chcesz naprawic **dane**, rob to w generatorze i porownaj `<published>` z data widoczna na
stronie artykulu — dopiero to rozstrzyga, czy zle parsujemy, czy zrodlo naprawde tak podaje.
Konkretny przypadek gov.pl czeka w `~/git/GIT-TASKS.md` §6.

Drugie ustalenie z tej samej sesji, o dobieraniu wpisow do panelu: pula wszystkich wpisow
posortowana po dacie = 3-4 najczesciej aktualizowane zrodla zajmuja wszystkie miejsca. Jeden
naglowek na zrodlo daje rotacje i sens dokladaniu feedow.
