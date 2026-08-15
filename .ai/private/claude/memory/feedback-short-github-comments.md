---
name: feedback-short-github-comments
description: "Zachowanie na GitHubie: pisac krotko (dlugie analizy na czat), po odniesieniu sie do recenzji zamykac watki i dawac lapke w gore, i odpowiadac w jezyku recenzenta"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 07852de2-e231-4f84-9025-d8d962981d0b
  modified: 2026-08-15T02:50:10.772Z
---

Komentarze na GitHubie maja byc **krotkie**. Uzytkownik powiedzial wprost
(2026-08-01): *"ogolnie nie ma potrzeby sie rozpisywac na githubie, najwazniejsze
rzeczy krotko i tyle"*.

**Why:** wczesniejsze komentarze na PR-ach wambridge byly bardzo dlugie (pelne
tabele, sekcje, cytaty z logow). Trescowo dobre, ale to nie jest format, ktorego
on chce na GitHubie — repo czyta tez ChatGPT i sam autor, a scianka tekstu
utrudnia wylapanie sedna.

## Domykanie recenzji — **rob to zawsze, nie tylko gdy poprosi**

Uzytkownik, 15.08.2026: *„jak juz sie poodnosisz do reviewow to daj resolved gdzie pasuje,
a na przydatne uwagi dawaj lapke w gore"* — i zaraz potem: *„te reakcje itd. to postaraj sie
ogolnie na przyszlosc, nie tylko teraz tu"*. To jest **rutyna**, nie jednorazowa prosba.

Po odniesieniu sie do recenzji, w tej samej turze:

1. **Lapka w gore** na kazdej merytorycznej uwadze — takze na tych typu „Info", jesli
   faktycznie cos wniosly. Boty wprost o to prosza (*„React with 👍 / 👎"*) i to jest ich
   petla zwrotna. Reakcje **dzialaja tokenem appki** → [[claudiusz-wrapper]].
2. **Zamknij watki**, ktore naprawiles. `resolveReviewThread` **nie dziala** tokenem appki
   (`Resource not accessible by integration`), wiec idzie tokenem uzytkownika przez GraphQL —
   szczegoly w [[github-tooling-workflow]]. `gh` nie ma na to komendy.
3. Nierozwiazany watek blokuje merge, gdy repo ma `required_conversation_resolution`.

## Jezyk

**Odpowiadaj w jezyku recenzenta.** Boty pisza po angielsku → odpowiadasz po angielsku.
Rozmowa z uzytkownikiem na czacie zostaje po polsku; to sa dwa rozne audytoria i nie ma
powodu ich mieszac. 15.08.2026 odpisalem Devinowi i Codexowi po polsku — poprawione.

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
