---
name: github-personal-account-limits
description: "trvny to konto osobiste, nie organizacja: custom properties sa niedostepne (funkcja wylacznie org), a pliki spolecznosciowe dziedzicza sie z repo trvny/.github zamiast siedziec w kazdym repo"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b9d96a3a-e8be-49ee-bfe9-fd8c41ecc18b
  modified: 2026-08-12T06:06:05.886Z
---

## Custom properties: NIE DA SIE, i to nie jest brakujace ustawienie

Sprawdzone 12.08.2026, trzy niezalezne potwierdzenia:

```
repos/trvny/trvny/properties/values  → 404
orgs/trvny/properties/schema         → 404
users/trvny .type                    → "User"
```

**Custom properties istnieja wylacznie na poziomie organizacji** — schemat definiuje sie w org,
wartosci ustawia na repo nalezacych do tej org. Konto osobiste nie ma gdzie zdefiniowac schematu.
Nie szukaj tego w ustawieniach repo, bo tam tego nie ma i nie bedzie.

Potwierdza to niezaleznie [[gh-app-claudiusz69]]: appka ma w **definicji** uprawnienia
`organization_custom_properties` i `repository_custom_properties`, ale instalacja ich nigdy nie
materializuje — wlasnie dlatego, ze wlascicielem jest konto osobiste.

Jedyny mechanizm klasyfikacji, jaki tu dziala, to **topics** (te tagi w sidebarze: `2137`,
`awesome`, `dotfiles`, `pl`, `xd`…).

Gdyby kiedys naprawde mialy byc properties: darmowa organizacja + przeniesienie repo. **Wyjatek
twardy: `trvny/trvny` musi zostac na koncie uzytkownika**, bo profil renderuje sie wylacznie
z repo o nazwie rownej loginowi na koncie osobowym. Przeniesienie go do org wylaczyloby profil.

## Pliki spolecznosciowe dziedzicza sie z `trvny/.github`

Ustalone przez uzytkownika 12.08.2026: repo `trvny/.github` dziala jako **fallback** —
`CODE_OF_CONDUCT`, `CONTRIBUTING`, `SECURITY`, `ISSUE_TEMPLATE`, `PULL_REQUEST_TEMPLATE`,
`FUNDING` stamtad obowiazuja w kazdym repo, ktore nie ma wlasnego; **plik lokalny wygrywa**.

Konsekwencja przy pracy: **nie dosypuj plikow spolecznosciowych per repo z automatu.** Domyslnie
ida centralnie do `.github`, a wersja lokalna powstaje tylko tam, gdzie repo naprawde potrzebuje
wlasnej (uzytkownik: „rzeczowe beda w razie potrzeby w poszczegolnych repo").

**Haczyk pomiarowy — zmierzony, nie zgadniety (12.08.2026).** `community/profile` **liczy
odziedziczone**: po dodaniu szablonow do `trvny/.github` wskaznik `trvny/trvny` skoczyl 85% → **100%**,
a `pull_request_template` zmienil sie na `jest`, mimo ze plik lezy w innym repo.

Ale pole **`issue_template` zostaje `BRAK` nawet przy zdrowiu 100%** — bo odnosi sie do
pojedynczego, starego `ISSUE_TEMPLATE.md`, a nie do katalogu `ISSUE_TEMPLATE/` z formularzami
YAML. **To falszywy negatyw, nie brak szablonu.** Nie dodawaj drugiego szablonu, zeby „zalatac"
to pole; rozstrzyga `health_percentage`, nie ten wpis.

(Wczesniejsza wersja tej notatki twierdzila cos odwrotnego — ze profil nie liczy odziedziczonych.
Bledne, obalone pomiarem tego samego dnia.)

Powiazane: [[git-folder-layout]], [[github-account-rename]].
