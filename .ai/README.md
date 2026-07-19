# Private AI scaffold

Ten katalog przechowuje mały, prywatny kontrakt zachowania dla narzędzi AI używanych przez `trvny`.

Nie jest to framework ani próba zastąpienia ustawień konkretnych produktów. To cienka warstwa wspólnych preferencji, z której adaptery i narzędzia mogą korzystać bez kopiowania wielkiego promptu do każdego miejsca.

## Pliki

- `profile.yaml` — przenośny profil zachowania i preferencji platformowych.
- `/AGENTS.md` — główne instrukcje dla agentów pracujących w repozytorium.
- `/.github/copilot-instructions.md` — zwięzłe instrukcje repozytoryjne dla GitHub Copilot.
- `/.github/agents/trvny-maintainer.md` — wyspecjalizowany profil maintenera dla Copilot cloud agent i CLI.

## Założenia

- Zwykły czat pozostaje trybem domyślnym.
- Narzędzia są używane dla dostępu, aktualności, weryfikacji lub wykonania działania.
- Styl komunikacji nie steruje uprawnieniami, bezpieczeństwem ani routingiem.
- Konfiguracje deterministyczne należą do runtime'u.
- Model służy głównie do interpretacji, syntezy i pracy z niejednoznacznością.
- Surowe źródła, wiki, pamięć i wnioski modelu są oddzielnymi warstwami.

## OpenAI

Dla krótkiego przepływu z własną pętlą aplikacji preferuj Responses API. Agents SDK ma sens, gdy potrzebne są zarządzane narzędzia, handoffy, guardraile, sesje, tracing lub praca wieloetapowa.

Sekrety:

```text
OPENAI_API_KEY
```

Wartość ma pochodzić ze środowiska lub menedżera sekretów. Nie zapisuj jej w Git.

## Cloudflare

Dla nowego projektu Workers preferowany jest `wrangler.jsonc` z jawnym `compatibility_date`.

Przykładowy minimalny kształt:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "replace-me",
  "main": "src/index.ts",
  "compatibility_date": "YYYY-MM-DD",
  "observability": {
    "enabled": true
  }
}
```

Nie kopiuj tego pliku ślepo. Data zgodności, obserwowalność, bindingi i flagi kompatybilności muszą odpowiadać konkretnemu Workerowi.

Wartości sekretów przechowuj przez mechanizmy Cloudflare lub lokalnie w ignorowanym `.dev.vars`.

## GitHub i Copilot

GitHub obsługuje kilka zakresów instrukcji:

- `.github/copilot-instructions.md` — cały repozytorium,
- `.github/instructions/*.instructions.md` — reguły zależne od ścieżki,
- `AGENTS.md` — instrukcje agentowe, z możliwością zagnieżdżania,
- `.github/agents/*.md` — profile agentów specjalistycznych,
- `.github/prompts/*.prompt.md` — jawnie uruchamiane workflowy.

Nie wkładaj wszystkiego do jednego pliku. Globalne zasady mają być krótkie, a techniczne wyjątki powinny mieszkać blisko kodu, którego dotyczą.

## Microsoft

Dla Azure, .NET, PowerShell, Windows, GitHub integration i pozostałych technologii Microsoft sprawdzaj aktualny stan w Microsoft Learn. Nie utrwalaj w profilu szczegółów, które mogą szybko się zestarzeć.

## Co można dodać później

Dopiero gdy pojawi się realna potrzeba:

```text
.ai/profiles/
.ai/adapters/
.github/instructions/
.github/prompts/
.github/agents/reviewer.md
```

Najpierw kilka plików, które faktycznie są używane. Reszta niech nie wyrasta jak paprotka z dashboardu SaaS.
