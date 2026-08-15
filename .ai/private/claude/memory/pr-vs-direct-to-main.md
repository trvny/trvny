---
name: pr-vs-direct-to-main
description: "Don't open a branch+PR for a one-line fix just to merge it a minute later — commit straight to main unless a push-triggered deploy, a PR-only workflow, or the bot reviewers are worth having."
metadata: 
  node_type: memory
  type: feedback
  modified: 2026-08-15T02:25:06.530Z
  originSessionId: b9d96a3a-e8be-49ee-bfe9-fd8c41ecc18b
---

For small, self-contained changes — docs, config, a one-file fix — **commit straight to `main`**.
Branch + PR + merge-a-minute-later is ceremony that buys nothing here.

**Why it's safe in these repos** (checked 2026-08-02): nothing blocks a direct push. `trvny` is
private on a free plan so branch protection isn't even available; `feeds` has a protection entry but
it is empty (0 required checks, no required reviews, `enforce_admins: false`); `wambridge` and
`autka` are unprotected. And the CI that matters runs on **`push` as well as `pull_request`** —
`mega-linter`, `android-ci`, `worker-ci`, `build` all carry both triggers, so a direct commit is
still linted and built.

**Use a branch + PR when any of these apply:**

- **A push-triggered workflow deploys.** In `feeds`, `deploy-pages.yml`, `release.yml` and
  `deploy-cloudflare-pages.yml` fire on push to `main` — a bad direct commit doesn't just turn CI
  red, it ships. This is the one genuinely strong argument.
- **A workflow is `pull_request`-only.** `trvny/claude-review.yml` is; committing directly skips
  automated review entirely.
- The change spans several commits, or is long-running work (the `wambridge` pattern).
- You actually want it reviewed.
- **New code, not an edit to old code.** A new module with concurrency, budgets or network
  error-classification is exactly what `chatgpt-codex-connector[bot]` and
  `devin-ai-integration[bot]` are good at — see [[gh-app-claudiusz69]] for who catches what and
  why the PR must be opened as `trvny`, not as the App.

> **Skorygowane 12.08.2026 — sam to zle zastosowalem.** Siedem commitow w `feedseek` poszlo
> prosto na `main`, w tym trzy **nowe** moduly (`article_image.py`, `google_news.py`,
> `docs_sources.py`) z pulami watkow, budzetami i podzialem bledow na trwale/przejsciowe.
> To nie byly „drobiazgi", a `feeds` ma na pushu do `main` `deploy-pages.yml` / `release.yml` /
> `deploy-cloudflare-pages.yml` — czyli warunek „push deployuje" z tej samej notatki byl
> spelniony. Koszt byl realny, nie teoretyczny: w tym diffie siedzial blad klasy dokladnie
> Codexowej (`FEEDSEEK_IMAGE_LOOKUPS=0` znaczylo „bez limitu" zamiast „wylacz", bo `if limit`
> jest falszywe przy zerze). Znalazlem go sam przy smoke-tescie, ale to byl przypadek.
> **Test: czy plik jest nowy albo czy CI ma szanse tego nie zlapac — jesli tak, to PR.**

> **Drugi raz, 15.08.2026 — `trvny/trvny`, siedem commitow prosto na `main`.** Hook
> `SessionStart`, `AGENTS.md`, przebudowa `.ai/`, config MegaLintera. Test z korekty wyzej
> zadzialalby bez pudla: **CI nie mialo szans tego zlapac** — hook byl wykluczony z lintowania
> (`.claude/` w `FILTER_REGEX_EXCLUDE`), a odwroconej precedencji w `AGENTS.md` zaden linter nie
> wyapie. Recenzja subagenta znalazla potem **cztery prawdziwe bledy**, w tym hook, ktory nigdy
> sie nie uruchamial na Windowsie. Wszystkie byly klasy PR-owej.
>
> **Mechanizm porazki, ten sam oba razy:** ciag drobnych edycji, kazda z osobna trywialna,
> i ani razu przeliczenia calosci. Decyzja „main czy PR" zapada przy pierwszym commicie i potem
> nikt jej nie rewiduje, choc zakres puchnie.
>
> **Poprawka od uzytkownika, ta sama sesja — moje sformulowanie bylo zle.** Napisalem
> „decyduj na starcie", a na starcie wlasnie nie wiadomo: *„czasem zaczyna sie od »a tylko to
> zmienie« a konczy »13 changed files, 23452 lines«"*. Zaczynaj bez otwierania czegokolwiek.
> **Punkt decyzyjny jest przed pushem**, bo dopiero tam informacja istnieje: zerknij na
> `git diff --stat` i jesli urosl snieg — kilka plikow albo cokolwiek, czego CI nie lintuje —
> pozbieraj te commity na galaz i zrob PR. To jest wykonalne, „przewidz zakres z gory" nie jest.

**Why:** stated 2026-08-02 — "jeśli ma iść branch+pr tylko po to żeby minutę później to merge to
chyba lepiej od razu to na main". The default agent habit of branching off the default branch is a
generic safety rule, not a rule of these repos; don't apply it reflexively here.

Still holds regardless of route: `git fetch` immediately before pushing — see [[git-sync-direction]].
