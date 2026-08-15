---
name: feedback-measure-before-theorising
description: "lektura kodu podpowiada hipotezy, rozstrzyga sonda - 2026-08-01 trzy diagnozy z samego czytania kodu, wszystkie trzy obalone pomiarem"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7f6f9de6-09c0-4033-8e75-7c1c3d45b9ab
  modified: 2026-08-08T12:21:14.435Z
---

**Lektura kodu podpowiada hipotezy. Rozstrzyga sonda.** Przy debugowaniu na zywym
sprzecie stawiac diagnoze dopiero po pomiarze, a jesli pomiaru nie ma — mowic wprost,
ze to hipoteza, i **poprosic o instrument** zamiast budowac na niej poprawke.

Dowod z jednej sesji (2026-08-01, [[wambridge-project]]) — trzy diagnozy postawione
z samego czytania kodu, wszystkie trzy obalone pomiarem:

1. **"kolejka C++ nie dochodzi do potoku"** — sonda `PCM WriteFile` pokazala osiem
   udanych zapisow. Dochodzila.
2. **"zegar nigdy nie zatrzaskuje sie na 1,0x"** — wyciagniete z pierwszych 20 sekund
   przebiegu; zatrzask nastepowal po ~100 s. Okno pomiarowe bylo za krotkie.
3. **"`StartPlaybackEvent` nie przychodzi na sciezce URL"** — przychodzi, gdy nasluch
   siedzi na tym samym polaczeniu i nic nie ubija proby przedwczesnie.

Do tego jedna **poprawka wypuszczona na podstawie blednej hipotezy**: `f22821e`
ubijal poprzedni enkoder przy nowym zadaniu, bo zalozylem, ze nowe zadanie znaczy
"stare polaczenie umarlo". Bylo odwrotnie — glosnik wysyla drugie zadanie, gdy pierwsze
jeszcze zyje. Cofniete w `387b80c`.

**Why:** kod pokazuje, co *moze* sie stac; sprzet pokazuje, co *sie dzieje*. Przy
kapryonym urzadzeniu i wielowarstwowym potoku (foobar -> C++ -> helper -> FFmpeg ->
HTTP -> glosnik) roznica jest ogromna, a bledna diagnoza kosztuje cala runde: build,
instalacje, restart, test.

**How to apply:** zanim ktos zbuduje poprawke na twojej diagnozie — poprosic o sonde,
ktora ja potwierdzi albo obali. Jeden przebieg z licznikami jest tanszy niz jedna
runda naprawy w zla strone. Gdy pomiar obali wlasna teze, **odwolac ja jawnie i od razu**
w tym samym kanale, w ktorym padla, zeby nikt na niej nie budowal.
Instrumentacja: [[wambridge-testing-setup]].

## Subtelniejszy wariant: mierzyc, ale wnioskowac kategoriami

**2026-08-08, [[travny-hub-migration]].** Tego dnia mierzylem duzo — i mimo to dwa razy
z rzedu wypuscilem falszywe **twierdzenie o bezpieczenstwie danych**, bo rozumowalem
o *klasie* rzeczy zamiast o konkretnych przypadkach. Oba obalil recenzent, nie ja:

1. „pusty cache to pelny refetch — strata czasu, nie danych". Prawda dla skraperow,
   **falsz dla osmiu generatorow, ktore akumuluja historie**. `daily_quote` dokleja
   dzisiejszy wpis do cache'u; bez cache'u publikuje 1 wpis zamiast 43, **na trwale**.
2. „przycinanie cache'u po dacie jest bezpieczne". Falsz dla feedow wielozrodlowych:
   w `tvp` dwa zrodla to 97% wpisow, wiec ciecie po swiezosci skasowaloby cztery ciche
   zrodla w calosci.

**Why:** pomiar rozmiaru, liczby plikow i czasu nie jest pomiarem *semantyki*. „Cache"
brzmi jak rzecz odtwarzalna z definicji, wiec latwo pominac pytanie, czy akurat **ten**
cache da sie odtworzyc. Zdanie „to tylko cache / to tylko lint / to tylko formatowanie"
jest sygnalem ostrzegawczym, nie uzasadnieniem.

**How to apply:** kazde zdanie w rodzaju „to nie moze stracic danych" traktowac jak teze
do obalenia, a nie jak tlo. Konkretnie: znalezc **jednego pisarza i jednego czytelnika**
tych danych i przeczytac ich kod, zamiast wnioskowac z nazwy katalogu. Gdy zmiana dotyka
stanu trwalego, sprawdzic tez, **kto jeszcze** patrzy na sama obecnosc pliku — w tym
samym repo walidator odrozniał nowy feed od skasowanego po tym, czy istnieje plik cache.
