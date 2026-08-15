---
name: secret-scan-patterns
description: "Skanujac plik pod katem sekretow szukaj KSZTALTU wartosci, nie nazwy parametru - 08.08.2026 przepuscilem 2 z 4 kluczy, bo regex patrzyl na token= i feed=, a jeden siedzial w sciezce URL-a"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2ef21ff5-d29a-45eb-b7a5-86212835f59e
  modified: 2026-08-08T15:09:26.211Z
---

**Skanujac cokolwiek pod katem sekretow, szukaj ksztaltu wartosci, nie nazwy parametru.**

**Dowod, 08.08.2026** (eksport OPML do `trvny/trvny`, [[playlists-shared-trio]]). Recenzent
zglosil dwa sekrety, zredagowalem je i uznalem temat za zamkniety. W pliku byly **cztery**:

| gdzie | ksztalt | czy zlapalem |
|---|---|---|
| `old.reddit.com/.rss?feed=<40 hex>` | `feed=` | tak |
| `github.com/trvny.private.atom?token=<29 znakow>` | `token=` | tak |
| `miuipolska.pl/...?member_id=…&key=<32 hex>` | `key=` | **nie** — znalazl recenzent |
| `music-news.com/rss/<16 znakow>/UK/news` | **w sciezce**, bez parametru | **nie** — dopiero szerszy skan |

Moj regex szukal dokladnie `token=` i `feed=`, bo takie widzialem. Czwartego nie znalazlby
zaden wariant tego podejscia, bo tam nie ma parametru.

**Why:** nazwa parametru to konwencja autora strony, nie wlasnosc sekretu. Wlasnoscia sekretu
jest **wysoka entropia w miejscu, gdzie normalnie stoi identyfikator**. Skan po nazwach daje
falszywe poczucie, ze plik jest czysty — gorsze niz brak skanu.

**How to apply:** skanowac wzorcami po wartosci i przejrzec kazde trafienie:
`[0-9a-f]{24,}`, `[A-Za-z0-9+/]{24,}={0,2}`, `(?:token|key|api_?key|auth|secret|feed|access)=[^"&]{8,}`,
oraz **segmenty sciezki** `/[A-Za-z0-9]{16,}/`. Duzo falszywych trafien (zwykle URL-e
googlenews, feedburner) — to normalne, przeglada sie je oczami.

Rozstrzygniecie „sekret czy publiczna sciezka": **podmienic jeden znak**. Prawdziwy zwraca
tresc, podmieniony pustke albo blad — wtedy to credential. Tak potwierdzilem music-news.

Dwie rzeczy do powiedzenia wprost, gdy sekret juz jest w repo:
1. redakcja w **nowej** kopii nie usuwa ekspozycji, jesli oryginal lezy obok na `main`;
2. „ten token pewnie juz nie dziala" to teza do sprawdzenia, nie zalozenie — token GitHuba
   z tego pliku uzytkownik uznal za martwy, a **zwracal 30 wpisow**.

Repo prywatne obniza wage, ale nie zmienia zasady: nie dokladac drugiej kopii zywych
poswiadczen.

## Ten sam blad w innej skorze: regex zamiast struktury

Nie tylko sekrety. Przy szukaniu brakujacego `encoding=` w `trvny/feeds` (08.08.2026) regex
takze dawal falszywe wyniki, bo **urywa argumenty na pierwszym `)`** — `write_text(build(x),
encoding="utf-8")` wygladalo na brakujace. Do tego `Path.open(mode)` przyjmuje tryb jako
**pierwszy** argument, wiec sprawdzanie `args[1]` alarmowalo na `"rb"`. Rozwiazanie: skanowac
**AST**, i objac tez `pathlib.read_text/write_text`, nie samo `open()`.

Wspolny mianownik: regex widzi tekst, a pytanie dotyczy **struktury** (gdzie stoi argument,
jaka ma entropie wartosc). Gdy pytanie jest o strukture, narzedziem jest parser albo wzorzec
po ksztalcie wartosci — nie dopasowanie nazwy.

Pokrewne: [[feedback-measure-before-theorising]], [[feedseek-cache-and-lint]].
