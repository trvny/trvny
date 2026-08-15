---
name: gptomek-control-mailbox
description: "Skrzynka komend GPTomka: nowa sciezka przez issue #203 NIE dziala (zdarzenie issues nie dociera), dziala stara przez PR #176 — a ta wymaga istnienia galezi gptomek/control, wiec jej NIE KASOWAC"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2233a275-a8ec-4c34-99c6-3dd9b73abaae
  modified: 2026-08-15T01:23:06.076Z
---

Stan na **15.08.2026**, zaparkowane przez uzytkownika („niech na razie dziala na starym
pr'owym systemie"). Sprawdzac przez `gh api repos/trvny/trvny/issues/203` i logi Workera.

## Nie kasowac galezi `gptomek/control`

Kanal sterowania jedzie przez **zamkniety PR `trvny/trvny#176`**, ktorego body edytuje sie
o ukryty marker `<!-- gptomek-command:<base64url(JSON)> -->`. GitHub przestaje dostarczac
`pull_request.edited` po skasowaniu head refa, wiec galaz `gptomek/control` musi istniec —
mimo ze jest ~61 commitow za `main` i wyglada na porzucona. To jest **kotwica transportu**,
nie robocza galaz. Kod sam jej broni w `isProtectedBranch`.

## Nowa sciezka (issue #203) jest wdrozona i nie dziala

PR #204 zmergowany 14.08 dodal issue #203 jako skrzynke „branchless". Wdrozone i zywe —
ale zdarzenie do Workera **nie dociera**. Wykluczone, kolejno:

| hipoteza | dowod ze nie |
|---|---|
| kod niewdrozony | Worker `kanarek-companion` wersja 62, `2026-08-14T17:54:46Z`, minute po merge'u |
| blad w budowie `target` | `companionTargets` czyta `payload.issue.number` dla `issues`, poprawnie |
| `SUPPORTED_EVENTS` blokuje | `issues` jest na liscie, a lista sluzy **tylko do logowania** |
| `sender.login` != `trvny` | edycja tokenem `gho_` konta `trvny` tez nie odpalila |
| GPTomek nie umie pisac do issues | udowodnione — skomentowal #203 przez #176 |
| brak uprawnienia Issues u kompaniona | ma „Read and write access to discussions, **issues**, and pull requests" |
| oczekujaca zgoda na uprawnienia | uzytkownik zatwierdzil przed testem |

Logi Cloudflare (24 h): **zero** zdarzen `issues`, przy 111 zalogowanych z `trvny/trvny`.
Worker loguje tez zdarzenia nieobslugiwane (widac `pull_request_review_comment` z
`supported:false`), wiec `issues` zostawiloby slad. Zastrzezenie: `head_sampling_rate: 0.1`,
wiec brak wpisu sam w sobie nie jest dowodem — ale **brak komentarza jest nieczuly na
probkowanie** i handler nie wykonal sie ani razu przy ~8 probach.

## Co zostalo do sprawdzenia

Jedno miejsce: **czy GitHub w ogole wysyla te dostawe**. Recent deliveries Appki
kanarek-companion, filtr `issues`. Brak wpisu = nie wysyla. 2xx = dochodzi i cos je po cichu.
4xx/5xx = trop w response body.

Alternatywa bez klikania: podbic `head_sampling_rate` z `0.1` na `1` w
`gh-apps/kanarek-companion/wrangler.jsonc`, wdrozyc, powtorzyc edycje #203 — wtedy logi
Cloudflare rozstrzygaja i da sie je odczytac connectorem.

## Dlug do sprzatniecia, jak juz zadziala

`gptomek-issue.ts` to **shim, nie zamiana**: udaje PR 176 (`legacyTarget`) i przepisuje
`PATCH /pulls/176` na `/issues/203` w warstwie HTTP, bo `handleGptomekControl` twardo
bramkuje `target.pullRequestNumber === 176`. `index.ts` routuje oba zdarzenia naraz.
Docelowo: deskryptor skrzynki zamiast stalej, `issueMailboxFetcher` do kosza, `CONTROL_BRANCH`
z `isProtectedBranch`, kasacja galezi, oba README (`gh-apps/gptomek`, `gh-apps/kanarek-companion`)
dalej opisuja stary kanal jako obowiazujacy.

Powiazane: [[gh-bot-gptomek]], [[gh-app-claudiusz69]].
