---
name: trvny-service-health
description: Check TRAVNY ecosystem service health through the existing read-only Status MCP, optionally focusing on a single project or using a deep TVPI probe.
---

# TRAVNY service health

Use the existing `status` MCP tool for TRAVNY service health, not separate ad-hoc probes or another monitoring backend.

1. Call `status` without arguments for the four-service roll-up: `tvpi`, `feeds` (Feedseek compatibility selector), `weather`, and `autka`.
2. When the request concerns one service, pass its `project` selector. Use `deep: true` only for an explicitly requested deep TVPI probe, since it performs additional channel checks.
3. Report each project's `verdict` and `headline`, the returned `checkedAt` timestamp, and the overall assessment. Distinguish `degraded`, `down`, and `error`; do not convert an unreachable check into a healthy verdict.
4. Use `structuredContent.projects` where available. The service returns live checks, not continuous monitoring or historical uptime.
5. If the MCP connection is unavailable or unauthorized, say so. Never ask to paste a production token into a conversation, embed it in URLs, manifests, or logs, or bypass the authentication gate.
