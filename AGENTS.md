# AGENTS.md

## Zakres

Ten plik dotyczy całego repozytorium `github.com/trvny/trvny`, chyba że katalog niżej zawiera własny `AGENTS.md`.

Repozytorium jest prywatnym centrum roboczym użytkownika `trvny`: profilem, zbiorem konfiguracji, skryptów, feedów, umiejętności i odsyłaczy do projektów. Preferuj konsolidację nad dokładaniem kolejnych luźnych bytów.

Motto robocze:

> po kolei, na spokojnie

## Sposób współpracy

- Zwykły czat jest trybem domyślnym. Odpowiadaj normalnie, bez uruchamiania agentowego kombajnu do prostego pytania.
- Pisz w języku użytkownika. Polski może być swobodny i bez korporacyjnej waty.
- Najpierw sedno. Rozwijaj temat tylko na tyle, ile wymaga decyzja lub poprawne wykonanie.
- Nie stosuj teatralnego role-play ani promptów typu „world-class principal architect”. Kompetencję pokazuj przez wynik.
- Nie chwal automatycznie każdego pomysłu. Dawaj szczery, konkretny feedback.
- Zadawaj pytania tylko wtedy, gdy brak informacji blokuje pracę albo istotnie zmienia rezultat.
- Nie pokazuj prywatnego toku rozumowania. Podawaj wniosek, kluczowe przesłanki i sposób weryfikacji.
- Nie kończ każdej odpowiedzi ofertą dalszej pomocy.

## Zasady zmian w repozytorium

1. Najpierw sprawdź istniejącą strukturę, konfiguracje i konwencje.
2. Preferuj małe, odwracalne zmiany zamiast szerokich przebudów.
3. Nie przenoś ani nie usuwaj plików bez wyraźnej potrzeby.
4. Nie twórz nowego frameworka, warstwy abstrakcji ani podagenta, jeśli prosty plik lub funkcja wystarczy.
5. Nie duplikuj źródeł prawdy. Konfiguracja powinna mieć jedno główne miejsce.
6. Zachowuj istniejący styl projektu, chyba że zadanie jawnie obejmuje jego zmianę.
7. Wygenerowane pliki oznaczaj lub umieszczaj tak, by nie były mylone ze źródłami ręcznie utrzymywanymi.

## Priorytety techniczne

Repozytoria użytkownika korzystają między innymi z:

- TypeScript i JavaScript,
- Python,
- Kotlin i Gradle,
- npm,
- JSON, YAML i TOML,
- Android,
- Cloudflare Workers i Pages,
- narzędzi LLM, skills, MCP i agentów.

Nie zakładaj jednego stosu dla całego repozytorium. Wykrywaj go lokalnie na podstawie plików projektu.

## Weryfikacja

Przed zakończeniem zadania:

- uruchom istniejące testy, lint i build, jeśli są dostępne i proporcjonalne do zmiany,
- korzystaj z poleceń z `package.json`, `pyproject.toml`, `Makefile`, `gradlew` lub dokumentacji projektu,
- nie instaluj globalnych zależności bez potrzeby,
- nie zmieniaj lockfile, jeśli zadanie nie wymaga zmiany zależności,
- dla dokumentacji sprawdź ścieżki, odsyłacze i nazwy plików,
- jeśli pełna weryfikacja nie jest możliwa, napisz dokładnie czego nie sprawdzono.

## Narzędzia i agentowość

- Używaj narzędzi tylko dla aktualności, dostępu do danych, weryfikacji lub wykonania działania.
- Preferuj deterministyczny kod i runtime do routingu, walidacji, parsowania i operacji powtarzalnych.
- Model wykorzystuj do interpretacji, syntezy, pracy z niejednoznacznością i oceny kompromisów.
- Podagentów używaj tylko przy niezależnych strumieniach pracy, specjalizacji lub osobnej weryfikacji.
- Po działaniu raportuj wynik, zmienione pliki, testy i ograniczenia. Nie publikuj surowej telemetrii.
- Częściowego sukcesu nie przedstawiaj jako pełnego wykonania.

## Wiedza, pamięć i wiki

Rozróżniaj:

- surowe źródła,
- utrzymywaną syntezę lub wiki,
- indeksy i stan runtime,
- pamięć rozmowy,
- wnioski modelu.

Wiki i pamięć są warstwami pomocniczymi, nie automatycznie źródłem prawdy. Przy dokładnych liczbach, cytatach, kodzie i twierdzeniach wysokiego ryzyka wracaj do źródeł.

## Cloudflare

- Dla nowych projektów Workers preferuj `wrangler.jsonc`.
- Ustawiaj jawny `compatibility_date`.
- Traktuj konfigurację Wrangler jako źródło prawdy dla wdrożenia.
- Włączaj obserwowalność świadomie i dobieraj sampling do projektu.
- Nazwy wymaganych sekretów deklaruj w konfiguracji, ale wartości przechowuj wyłącznie jako sekrety środowiska.
- Nie commituj `.dev.vars`, tokenów API, identyfikatorów prywatnych ani danych konta, jeśli nie są przeznaczone do repozytorium.
- Nie dodawaj `nodejs_compat` automatycznie. Włącz go tylko wtedy, gdy zależności tego wymagają.

## OpenAI i inne modele

- Instrukcje stylu trzymaj osobno od narzędzi, guardraili, uprawnień i routingu.
- Dla krótkich przepływów nie buduj wieloagentowej orkiestracji bez potrzeby.
- Dla agentów rozdzielaj instrukcje, tools, handoffs, guardrails, sessions i tracing.
- Klucze API pobieraj ze środowiska lub menedżera sekretów. Nigdy nie zapisuj ich w repozytorium.
- Nie zakładaj, że obecność narzędzia oznacza obowiązek jego użycia.

## Microsoft i GitHub

- Dla repozytorium GitHub używaj `AGENTS.md` jako głównego kontraktu dla agentów.
- Instrukcje Copilota trzymaj w `.github/copilot-instructions.md`.
- Reguły zależne od ścieżki umieszczaj w `.github/instructions/*.instructions.md` zamiast rozbudowywać plik globalny.
- Dla technologii Microsoft i Azure opieraj istotne decyzje na aktualnej dokumentacji Microsoft Learn.

## Sekrety i bezpieczeństwo

Nigdy nie commituj:

- kluczy OpenAI,
- tokenów GitHub,
- tokenów Cloudflare,
- sekretów Azure lub Microsoft,
- zawartości `.env` i `.dev.vars`,
- prywatnych kluczy,
- ciasteczek i danych sesji.

Pliki przykładowe mogą zawierać wyłącznie nazwy zmiennych i bezpieczne placeholdery.

## Raport końcowy

Po zmianie podaj krótko:

- co zmieniono,
- jakie pliki powstały lub zostały zmodyfikowane,
- co zweryfikowano,
- czego nie udało się sprawdzić,
- czy pozostaje decyzja użytkownika.
