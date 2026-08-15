---
name: gh-bot-gptomek
description: "GPT/Codex ma wlasne konto-bota `gptomek[bot]` (id 314538226) — ale nie zawsze go uzywa, wiec autorstwo `trvny` na GH nie dowodzi, ze pisal czlowiek"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2ef21ff5-d29a-45eb-b7a5-86212835f59e
  modified: 2026-08-08T11:07:19.168Z
---

Od **2026-08-08** GPT ma na GitHubie wlasna tozsamosc, symetrycznie do mojej
([[gh-app-claudiusz69]]):

- login **`gptomek[bot]`**, id **314538226**, typ `Bot`
- to **GitHub App**, nie zwykle konto: https://github.com/apps/gptomek
- nazwa `GPTomek` bez `[bot]` **nie istnieje** jako user — `gh api users/GPTomek` zwraca 404.
  Szukaj po `gptomek[bot]`, inaczej wyjdzie, ze konta nie ma.

**Konsekwencja, ktora ma znaczenie przy czytaniu historii: GPT jeszcze nie pamieta,
zeby zawsze przez to konto pisac** (stan na 08.08.2026, slowa uzytkownika). Wiec
**autorstwo `trvny` na GitHubie przestalo dowodzic, ze pisal czlowiek** — moze byc
uzytkownik albo GPT, ktory zapomnial prefiksu. Dokladnie ta sama wpadka, ktora ja
zaliczylem 02.08 na trzech PR-ach.

**How to apply:** nie wnioskuj z samego loginu, kto jest autorem tresci, gdy sprawa jest
istotna — sprawdz tresc i kontekst. I nie „poprawiaj" cudzego autorstwa: przepisywanie
historii nie jest tego warte, tak samo jak nie bylo przy moich PR-ach.

Nie mylic z recenzentami-botami, ktore chodza po PR-ach niezaleznie:
`chatgpt-codex-connector[bot]` (automatyczny review Codexa, odpala sie **tylko na PR-y
otwarte z konta uzytkownika**) oraz `devin-ai-integration[bot]`. `gptomek[bot]` to
tozsamosc **do pisania**, tamte to recenzenci.
