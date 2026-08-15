---
name: github-rename-what-follows
description: "Po zmianie nazwy repo na GitHubie raw.githubusercontent i github.com przekierowuja, ale GitHub Pages NIE — trvny.github.io/<stara>/ zwraca 404 bez zadnego redirectu"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2233a275-a8ec-4c34-99c6-3dd9b73abaae
  modified: 2026-08-14T21:19:11.028Z
---

Zmiana nazwy repozytorium na GitHubie przekierowuje **mniej**, niz sie wydaje. Zmierzone
14.08.2026 przy `trvny/feeds` → `trvny/feedseek`:

| Adres | Po zmianie nazwy |
|---|---|
| `github.com/trvny/feeds` | **301** → `github.com/trvny/feedseek` |
| `raw.githubusercontent.com/trvny/feeds/main/...` | **200**, tresc serwowana |
| API (`gh api repos/trvny/feeds`, octokit, shields.io) | podaza za redirectem |
| `git fetch` ze starym URL-em | dziala, ale `git remote -v` dalej klamie |
| **`trvny.github.io/feeds/`** | **404. Zero redirectu.** |

**Pages jest tym jednym wyjatkiem** i wlasnie on boli, bo to publiczny adres, ktory ludzie maja
w zakladkach, a inne repo maja go zaszyty w kodzie. Nowy adres to `trvny.github.io/<nowa-nazwa>/`
i stary nie zostawia po sobie nic.

**Why:** wszystko inne dziala, wiec zmiana nazwy wyglada na bezbolesna i latwo nie zauwazyc, ze
zdechla akurat strona. U nas zdechl panel newsow na `travny.pages.dev` (fetchowal
`trvny.github.io/feeds/feed_*.xml`) i nikt tego nie widzial, bo JS po cichu nie renderowal nic.

**How to apply:** po kazdej zmianie nazwy repo przegrepuj **wszystkie** klony, nie tylko to jedno:

```
grep -rIn "github.io/<stara-nazwa>\b\|trvny/<stara-nazwa>\b" ~/git --exclude-dir=.git
```

Poprawiaj **przede wszystkim linki `github.io`** — reszta dziala przez redirect i mozna ja
uporzadkowac spokojnie. Uwazaj przy podmianie skryptem: jesli stara nazwa jest **prefiksem**
nowej (`feeds` ⊂ `feedseek`), to dwie reguly `str.replace` po kolei zrobia `feedseekeek`.
Podmieniaj jedna, najdluzsza forma i sprawdz wynik.

Pamietaj tez o `git remote set-url` w lokalnych klonach — fetch dziala mimo starego URL-a, wiec
nic Ci nie przypomni. Zwiazane: [[git-folder-layout]], [[travny-hub-migration]].

## Cloudflare renamu nie zauwaza

Sprawdzone connectorem 14.08.2026 na `feeds-proxy`: Workers Builds trzyma
`git_repository.repo_id` (u nas `1253326399`) i `provider_account_id` (`120686325`) —
**numerycznie, nie po slugu**. Oba zgadzaja sie z `gh api repos/trvny/feedseek --jq .id`
po zmianie nazwy, wiec polaczenie nie pekło i nie ma czego odtwarzac. `repo_name` w
konfiguracji buildu to zwykla etykieta i po renamie nadal pokazywala `feeds` — **nie**
traktuj jej jako dowodu na zerwane wiazanie. To samo dotyczy R2/KV/D1: sa per konto.

```
GET /accounts/{acct}/builds/workers/{script_tag}
```
`script_tag` wyciagniesz z `GET /accounts/{acct}/workers/services/{name}`.
