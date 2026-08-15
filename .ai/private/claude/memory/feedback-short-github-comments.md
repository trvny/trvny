---
name: feedback-short-github-comments
description: na GitHubie pisac krotko - najwazniejsze rzeczy i tyle; dlugie analizy zostawiac na czat
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 07852de2-e231-4f84-9025-d8d962981d0b
  modified: 2026-08-08T15:36:58.687Z
---

Komentarze na GitHubie maja byc **krotkie**. Uzytkownik powiedzial wprost
(2026-08-01): *"ogolnie nie ma potrzeby sie rozpisywac na githubie, najwazniejsze
rzeczy krotko i tyle"*.

**Why:** wczesniejsze komentarze na PR-ach wambridge byly bardzo dlugie (pelne
tabele, sekcje, cytaty z logow). Trescowo dobre, ale to nie jest format, ktorego
on chce na GitHubie — repo czyta tez ChatGPT i sam autor, a scianka tekstu
utrudnia wylapanie sedna.

**How to apply:** na GitHub idzie wniosek + minimalny dowod (kilka linii logu,
jedna tabelka jesli naprawde potrzebna) i tyle. Pelna analize, warianty,
zastrzezenia i rozumowanie zostawiac w rozmowie. Jesli czegos nie da sie skrocic
bez utraty sensu — link do artefaktu zamiast wklejania calosci.

## Nie tlumaczyc sie i nie wystawiac konfiguracji maszyny

**2026-08-08, mocniejsza wersja tej samej reguly.** Uzytkownik: *"nie masz obowiazku
wyjasniac wszystkiego kazdemu, czy np dzielic sie konfiguracja tego laptopa, po co"*.

Powod byl konkretny: wrzucilem na PR-y dwa komentarze-sprostowania z **wnetrznosciami jego
maszyny** — sciezka i zawartosc Android SDK, wersja JDK, katalog `javapath`, stan `JAVA_HOME`
i `PATH`, fakt ze nie ma Node'a. Do recenzji playlisty **nic z tego nie bylo potrzebne**.
Skasowane i zastapione jednym zdaniem; zostal tylko fragment dotyczacy repo (brak `gradlew`
w gicie), bo to dotyczy kazdego klonujacego.

**Why:** dwie osobne rzeczy. (1) Tracker to powierzchnia zewnetrzna — czytaja go boty i kto
tam jeszcze zajrzy; konfiguracja prywatnego sprzetu nie ma tam czego szukac, nawet w repo
prywatnym. (2) Rozbudowane samousprawiedliwianie („nie zbudowalem, bo u mnie brakuje X, Y, Z")
to i tak szum — recenzenta interesuje, ze nie bylo budowane, nie dlaczego.

**How to apply:** o niesprawdzonych rzeczach pisac **jednym zdaniem, bez inwentaryzacji
srodowiska**: „not built or run locally, CI covers that". Szczegoly srodowiska trzymac
w pamieci ([[android-build-not-possible-here]]) i w rozmowie, nie w PR. Zanim cokolwiek
o maszynie trafi na zewnatrz — sprawdzic, czy odbiorca w ogole tego potrzebuje do decyzji.

## Botom nie trzeba odpowiadac skrupulatnie

Uzytkownik, 2026-08-08: *„w odpowiadaniu botom na gh nie musisz byc skrupulatny"*.

Devin oznacza czesc uwag jako **📝 Info** i sam pisze, ze to nie defekt („benign", „worth
knowing"). Takie **zamykac bez odpowiedzi**. Odpowiedz nalezy sie temu, co realnie zmienia
kod — 🟡/🟨/🔍 u Devina, P1/P2 u Codexa — i wtedy krotko: co poprawione i w ktorym commicie.
Reakcja 👍 wystarczy za potwierdzenie, ze uwaga byla trafna.

Nie pisac elaboratow o tym, czego **nie** zmieniono i dlaczego; jedno zdanie albo nic.
