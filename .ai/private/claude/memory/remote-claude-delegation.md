---
name: remote-claude-delegation
description: "Kiedy oddelegowac robote zdalnemu Claude'owi zamiast robic ja lokalnie: skrystalizowany, zamkniety kawalek idzie zdalnie i wraca PR-em, glowne mieso zostaje w sesji z uzytkownikiem"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b9d96a3a-e8be-49ee-bfe9-fd8c41ecc18b
  modified: 2026-08-12T05:28:35.776Z
---

Model pracy ustalony **12.08.2026** przez uzytkownika: *„moment gdy skrystalizuje sie konkretna
rzecz do zrobienia w konkretnym celu, cyk pyk zdalny claude, a tu dalej sie ciagnie glowne mieso"*.

**Kryterium delegowania — nie „czy duze", tylko czy zamkniete:**

- da sie opisac akapitem, bez odwolania do kontekstu zbudowanego w tej sesji;
- ma kryterium „gotowe", ktore sprawdzi CI albo test, nie moja ocena;
- nie wymaga po drodze zdania uzytkownika.

Jesli ktorykolwiek punkt nie przechodzi — zostaje lokalnie. **Delegowanie eksploracji kosztuje
najwiecej**: w sesji 11–12.08 najwieksza poprawka w `feedseek` (0% → 67% obrazkow, zero zapytan
sieciowych) wzieta sie z jednego zdania uzytkownika kwestionujacego przeslanke („przeciez zwykle
jest thumbnail"). Zdalny agent zbudowalby to samo `article_image.py`, zaraportowal 39/60 i uznal
temat za zamkniety — bo miara sie zgadzala, tylko pytanie bylo zle. Patrz [[feedseek-entry-media]].

**Druga korzysc, wazniejsza niz rownoleglosc:** zdalna sesja **laduje PR-em z definicji**
(branch `claude/*`, commity podpisane oficjalnym kontem `github.com/claude`). Czyli auto-review
dostaje sie za darmo, bez polegania na tym, ze pamietam o wyborze trasy — co jest realnym
problemem, patrz [[pr-vs-direct-to-main]].

**Tryb awaryjny, o ktorym uzytkownik przypomnial:** nawet bez auto-triggera review da sie wywolac
recznie komentarzem `@codex review`. **Nie wiadomo, czy zadziala z konta bota** — wiele integracji
ignoruje komentarze innych botow, zeby nie robic petli. Do sprawdzenia przy najblizszym PR-ze:
napisac `@codex review` tokenem `claudiusz69` i zobaczyc, czy cokolwiek ruszy; jesli nie, mention
musi wyjsc od uzytkownika. Kontekst kto czym pisze: [[gh-app-claudiusz69]].

**Pulapka po stronie zdalnej:** sesja bez zakresu i bez kryterium konca po prostu wydaje limit.
Uzytkownik ma taki przypadek — zdalny Claude odpalil mu sie kiedys sam w `feeds`, zrobil m.in.
folder `.claude` i wyczerpal limit, a cel do dzis nie jest znany. To argument za scisle
zakresowanym zadaniem, nie przeciw delegowaniu.

## Mechanizm — sprawdzony 12.08.2026, dziala

Narzedzie `RemoteTrigger` (schemat przez `ToolSearch("select:RemoteTrigger")`). Cykl:
**`create` (enabled:false) → `run` → `list_runs` → `get_run_log`**. Odpalam to sam z sesji,
nie trzeba nic klikac.

- **`create` WYMAGA `job_config.ccr.environment_id`** — bez tego 400
  `job_config must set ccr.environment_id or ccr.self_hosted_runner_pool_id`.
  Dziala `env_012hKb6FvQjDd1PANJjVBArj` (istniejace srodowisko uzytkownika).
- Ksztalt body: `job_config.ccr.events[0].data.message.content` to prompt;
  `job_config.ccr.session_context` bierze `allowed_tools`, `autofix_on_pr_create: true`,
  `sources[].git_repository.url` (repo do sklonowania) i
  `outcomes[].git_repository.git_info{repo,branches}` (galaz wyjsciowa). Wiele repo naraz
  dziala — jedna sesja obsluzyla `feeds` i `Autka`.
- `enabled:false` + jawny `run` = odpalenie jednorazowe teraz, bez harmonogramu.
- Do nazwy galezi **dokleja sie losowy sufiks** (`claude/codeql-kotlin` →
  `claude/codeql-kotlin-78qnw5`), wiec nie zakladaj nazwy przy szukaniu PR-a.
- **PR-y wychodza jako `trvny`**, wiec auto-review dziala: 12.08 na `feeds#239` odezwal sie
  i Devin, i Codex, bez zadnego `@codex review`. Commity sa autorstwa
  `Claude <noreply@anthropic.com>`; odpowiedzi na review leca jako `trvny`, bo zdalna sesja
  nie ma tokenu appki ([[gh-app-claudiusz69]]).
- Model zdalny to domyslnie `claude-sonnet-5`.

**Sesja zyje dalej po pierwszym wyniku** — subskrybuje webhooki PR-a, sama poprawia uwagi
z review i planuje sobie kolejne pobudki. **Dlatego jeden `get_run_log` bywa nieaktualny:**
12.08 na jego podstawie orzeklem, ze agent zignorowal uwagi Codexa, a on juz je naprawil
w nastepnym przebudzeniu (commit `4d70cfe`). Zanim ocenisz zdalna robote, sprawdz `git log`
galezi, nie tylko log sesji.

**Co musi byc w prompcie** (wnioski z pierwszego uzycia):

- naglowek „ALREADY VERIFIED <data> — do not re-derive" z twardymi faktami; oszczedza sesji
  15 minut i chroni przed rozjechaniem sie przeslanek;
- hipoteza **oznaczona jako hipoteza** („test it, do not assume it") — inaczej ja potwierdzi;
- jawny zakaz na rzeczy nieodwracalne (u nas: nie ruszaj alertow, nie kasuj konfiguracji)
  plus polecenie „stan i napisz w opisie PR-a", zeby zablokowanie bylo wynikiem, nie cisza;
- **jawne zdanie, ze dobrze udowodniony wynik negatywny to sukces.** Bez tego agent szuka
  roboty na sile i wymusi zmiane tam, gdzie problemu nie ma.

Slabosc do pilnowania: prompt zawezony do zlego pytania zawezi cala robote. Kazalem pytac
„czy to trafia do APK" — Codex slusznie zauwazyl, ze brak w APK nie uzasadnia dismissu,
bo ten kod wykonuje sie na hoscie builda. Dziura byla w moim zleceniu, nie u agenta.

**Pierwsze uzycie** (12.08.2026): `feeds#239` (triage Dependabota — zamkniete),
`feeds#238` + `Autka#132` (CodeQL — [[codeql-kotlin-config-dead]]).
