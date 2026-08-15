---
name: gh-app-claudiusz69
description: "GitHub App \"Claudiusz69\" (id 4454097, dawniej co-tam) daje Claude'owi wlasna tozsamosc na GH; skrypt mintujacy token, zasady kto czym pisze, stan uprawnien"
metadata:
  node_type: memory
  type: reference
  originSessionId: 2ef21ff5-d29a-45eb-b7a5-86212835f59e
  modified: 2026-08-08T14:50:40.910Z
---

Zeby komentarze na GitHubie nie wygladaly, jakby uzytkownik pisal sam do siebie,
stoi wlasna **GitHub App `claudiusz69`** (utworzona 2026-08-01 jako `co-tam`,
przemianowana **2026-08-08**):

- **App ID** `4454097` (bez zmian), wlasciciel `trvny`, **installation_id** `150493073` (bez zmian)
- **id uzytkownika bota** `311718492` — tez bez zmian; przy zmianie nazwy appki
  zmienia sie tylko login, nie id
- ustawienia: https://github.com/settings/apps/claudiusz69
- zainstalowana na **8 repo** (`repository_selection: all`, sprawdzone z API 2026-08-08,
  ponownie po poludniu tego samego dnia): `trvny/trvny`, `trvny/tvpi`, `trvny/feeds`,
  `trvny/Autka` (**duze A**), `trvny/WiFi-Automatic`, `trvny/.github`, `trvny/wambridge`,
  `trvny/.ai`. Lista rosnie sama przy `repository_selection: all` — nie traktowac jej jak
  fakt trwaly, sprawdzac `gh api installation/repositories` ([[memory-state-vs-durable]])
- komentarze pojawiaja sie jako **`claudiusz69[bot]`** — sufiksu `[bot]` nie da sie zdjac
- **stara nazwa `co-tam` jest teraz wolna** — dokladnie jak przy `travino` → `trvny`
  ([[github-account-rename]]); nie polegaj na przekierowaniu starego slugu

**Zasada (ustalona 2026-08-02): wszystko, co Claude wystawia na GitHubie, idzie jako `claudiusz69[bot]`
— komentarze, odpowiedzi w review i autorstwo commitow.** Domyslne `gh` dziala jako `trvny`
i nic tego nie nadpisuje, wiec o prefiks trzeba pamietac za kazdym razem.

> **WYJATEK — SAME PR-y IDA Z KONTA `trvny` (ustalone 2026-08-08).** Automatyczny review
> Codexa **odpala sie tylko na PR-y otwarte z konta uzytkownika**; PR wystawiony przez
> bota zostaje bez reakcji i bez recenzji. Wyszlo na `wambridge` #38: zielone
> CI 6/6 i zero review, dopiero po zamknieciu i otwarciu tej samej galezi jako `trvny`
> (#39) proces ruszyl. Wiec: **`gh pr create` zwyklym `gh`**, a
> **autorstwo commitow dalej botem** — uzytkownik potwierdzil, ze commity moga
> zostac botem. To koryguje zapis z 02.08, ktory traktowal PR-y wystawione jako `trvny`
> za wpadke; przy wlaczonym review Codexa jest odwrotnie.
>
> **Recenzenci sa dwaj i lapia rozne rzeczy** (`wambridge` #39): `devin-ai-integration[bot]`
> daje komentarze liniowe z sugestiami patcha (8 uwag, w tym jeden realny blad), a
> `chatgpt-codex-connector[bot]` osobne review kilka minut pozniej — i to on zlapal blad,
> ktorego Devin nie zauwazyl. **Nie merguj po samym Devinie**, poczekaj tez na Codexa.
> Uwaga przy czytaniu: po pushu GitHub **przesuwa numery linii starych komentarzy**, wiec
> wygladaja na nowe. Rozstrzyga `created_at`, nie pozycja.
>
> **Uzytkownik prosi o `+1` na uzytecznych uwagach** (2026-08-08) — Devin sam o to prosi
> stopka „React with 👍". Reakcje ida tokenem appki i **dzialaja**:
> `gh api --method POST repos/{o}/{r}/pulls/comments/{id}/reactions -f content=+1`.
> Uwaga na sciezke: komentarz czyta sie z `repos/{o}/{r}/pulls/comments/{id}`
> (bez numeru PR) — `pulls/{nr}/comments/{id}` zwraca 404.

```bash
GH_TOKEN=$(py ~/.claude/tools/gh-app-token.py --app claudiusz69) gh pr comment 7 --body-file review.md
```

Latwo o wpadke: 2026-08-02 trzy PR-y (`trvny#136`, `feeds#203`, `wambridge#28`) i odpowiedz na
review wyszly jako `trvny`, bo prefiks zostal pominiety. Odpowiedz zostala skasowana i wystawiona
ponownie jako bot; PR-om zostawiono bledne autorstwo, bo poprawka wymagalaby zamkniecia ich,
przepisania commitow i force-pusha — nieproporcjonalnie do zysku.

> **Powtorzylo sie 2026-08-08 — to nie jest jednorazowa wpadka, tylko stala pulapka.**
> Trzy komentarze (`trvny#183`, `feeds#231` ×2) wyszly jako `trvny`; **zauwazyl to uzytkownik,
> nie ja**. Wzorzec jest zawsze ten sam: pisze sie odpowiedzi na review z prefiksem, a potem
> zwykly komentarz do PR-a leci golym `gh pr comment` albo `gh api ... /issues/N/comments`
> i prefiks wyparowuje. **Kazde wyjscie na GH sprawdzac przez `--jq '.user.login'`** — odpowiedz
> zawiera autora, wiec kosztuje zero.
>
> Komentarze (w odroznieniu od PR-ow) **da sie naprawic po fakcie**: zapisac tresc
> (`gh api repos/{o}/{r}/issues/comments/{id} --jq '.body' > plik`), wystawic ponownie tokenem
> appki, potem `--method DELETE` na starym. Zajmuje minute, wiec nie ma powodu zostawiac.

**Wyjatek (ustalony 2026-08-02): zamykanie watkow review idzie jako `trvny`, zwyklym `gh`.**
`resolveReviewThread` tokenem appki zwraca `Resource not accessible by integration` mimo
`pull_requests:write`. Rozstrzygniecie watku to czynnosc, nie tresc — nie podszywa sie pod
nikogo, wiec nie ma po co kombinowac.

> **I to nie jest kosmetyka: `trvny/feeds` ma na `main` `required_conversation_resolution`.**
> Ustalone 2026-08-08 po kilku falszywych tropach. Objaw: wszystkie checki zielone,
> `mergeable: MERGEABLE`, a `mergeStateStatus: BLOCKED` — bez zadnego komunikatu, co blokuje.
> To **nie** byly ani wymagane recenzje (`required_pull_request_reviews: null`), ani rulesets
> (puste), ani `strict` (galaz byla `behind: 0`). Diagnoza:
> `gh api repos/{o}/{r}/branches/main/protection --jq '.required_conversation_resolution'`,
> a lista otwartych watkow przez GraphQL `reviewThreads{nodes{id isResolved}}`.
> Kazdy komentarz liniowy bota to osobny watek — na jednym PR bylo ich 12.

- `--whoami` pokazuje tozsamosc i instalacje; `--repo owner/repo` zawezi token
- token zyje 1h, skrypt cache'uje go w `~/.local/share/gh-app/claudiusz69.token` i sam odswieza
- **zero zaleznosci pip** — JWT RS256 podpisywany przez `openssl` (3.5.7 jest w systemie),
  bo `PyJWT`/`cryptography` na tej maszynie NIE ma

**Commity jako bot** (2026-08-01): autor commita to nieuwierzytelnione pole, wiec
mozna je podpisac tozsamoscia appki. **Nie ustawiac na stale w `git config`** — wtedy
wlasne commity uzytkownika z tego katalogu tez byly by botem. Uzywac override per commit:

```bash
git -c user.name="claudiusz69[bot]" \
    -c user.email="311718492+claudiusz69[bot]@users.noreply.github.com" commit ...
```

Push i tak leci poswiadczeniami uzytkownika, bo appka ma `contents: read` — na GitHubie
widac "trvny pushed" z commitami autorstwa bota, co jest poprawnym obrazem.
**Stare commity zachowaja `co-tam[bot]` w autorze** — email z id `311718492` dalej
linkuje do wlasciwego konta, wiec nie ma czego przepisywac.

**Pliki:**
- skrypt: `C:\Users\travn\.claude\tools\gh-app-token.py` (nazwa po `--app` to nazwa
  **lokalnego configu**, nie slug z GitHuba — ale trzymamy je zgodne)
- konfiguracja + klucz prywatny: `C:\Users\travn\.local\share\gh-app\claudiusz69.json` +
  `claudiusz69.2026-08-01.private-key.pem` — **przeniesione z `~/.gh-app` 2026-08-08**,
  zeby nie smiecic w korzeniu HOME ([[no-clutter-in-home]]). Dalej **poza** `~/git`,
  wiec zaden glob w repo tego nie zlapie. Po `Move-Item` ACL sie **wzmocnil**: te same
  trzy tozsamosci (SYSTEM / Administratorzy / travn, FullControl), ale z dziedziczonych
  zrobily sie jawne ACE z zablokowanym dziedziczeniem (`AreAccessRulesProtected=True`).
  Wczesniejszy zapis „ACL tylko SYSTEM/Administratorzy/travn" sugerowal celowe
  utwardzenie — w `~/.gh-app` to bylo **zwykle dziedziczenie** z `C:\Users\travn`,
  nic specjalnie ustawionego.

**Uprawnienia — PRZYCIETE, sprawdzone z API 2026-08-08.** Instalacja daje **34 uprawnienia,
z czego tylko trzy z zapisem**: `issues:write`, `pull_requests:write`, `discussions:write`.
`contents` zostaje na `read`. **`workflows` zniklo z listy calkowicie**, a `deployments`,
`statuses`, `packages`, `merge_queues`, `repository_custom_properties` zjechaly z `write`
na `read`. To zamyka zastrzezenie z 02.08 o osmiu nadmiarowych zapisach.

Na poziomie **definicji appki** (nie instalacji) wisza jeszcze trzy zapisy dotyczace
organizacji — `gists`, `organization_custom_properties`,
`organization_announcement_banners`, `custom_properties_for_organizations` — ale
`trvny` to konto osobiste, wiec instalacja ich nie materializuje. Dalej odczytywalne
sa `secrets`, `security_events`, `secret_scanning_alerts` na wszystkich 7 repo;
jesli kiedys ma byc minimum, to tam sie tnie.
Przyciecie tylko przez web UI: https://github.com/settings/apps/claudiusz69/permissions
— API tego nie zmienia, a **zmniejszanie zakresu wchodzi bez zatwierdzania przez instalacje**.

Podzial pracy do utrzymania: **appka pisze, uzytkownik pcha.** Komentarze ida tokenem appki;
`git push` leci poswiadczeniami `trvny`. Gdyby bot mial kiedys pchac sam, potrzebowalby
`contents: write` **i** `workflows: write` razem — osobna decyzja o duzo wiekszym zasiegu.

**Czego to NIE rozwiazuje:** oficjalne konto `github.com/claude` (id 81847, `@anthropics`)
podpisuje **commity** w sesjach chmurowych (branch `claude/*`) — patrz [[feeds-pr-140-websetup]].
Tego nie da sie odtworzyc lokalnie i nie wolno podszywac sie pod nie, ustawiajac
`user.email=noreply@anthropic.com`. Komentarze zawsze wychodza z uwierzytelnionego
tokena, wiec App to jedyna uczciwa droga. Kontekst: [[wambridge-project]],
[[feedback-short-github-comments]].

Od 08.08.2026 **GPT ma symetryczna wlasna appke** `gptomek[bot]` — patrz [[gh-bot-gptomek]].
Skutek uboczny: login `trvny` nie jest juz dowodem, ze pisal czlowiek.
