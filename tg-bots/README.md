# Telegram bots

[![Assistant CI](https://github.com/trvny/trvny/actions/workflows/tg-assistant-ci.yml/badge.svg?branch=main)](https://github.com/trvny/trvny/actions/workflows/tg-assistant-ci.yml) [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://developers.cloudflare.com/workers/)

| Component | Role | Go to |
| --- | --- | --- |
| [Cloudflare assistant](cloudflare-assistant/) | 24/7 Telegram webhook, chat/drafts, RSS, reminders and handoffs | [README](cloudflare-assistant/README.md) / `src/` |
| [Kanarek routing](../gh-apps/kanarek-review/) | Existing LLM provider selection; **do not duplicate** | [Router README](../gh-apps/kanarek-review/README.md) |
| [Pet Dispatcher](../mcp/pet-dispatcher/) | Scoped device, OS, repository and build work | [Dispatcher README](../mcp/pet-dispatcher/README.md) |

## Work here

Run `npm ci && npm run check && npm test` from `cloudflare-assistant/`. Its [CI workflow](../.github/workflows/tg-assistant-ci.yml) checks that app. Keep Telegram delivery in the Worker, provider routing in Kanarek, and privileged host work in Pet Dispatcher/Hermes. See [concept](CONCEPT.md) for planned additions.
