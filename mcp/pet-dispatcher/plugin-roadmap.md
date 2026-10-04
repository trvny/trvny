# Pet Dispatcher plugin roadmap

Status: **Foundation and Cockpit shipped; later phases remain open.** The Cloudflare control plane and local worker remain canonical; the plugin is a product/UX layer over that system, not a second dispatcher.

## Design rules

- Keep one control plane. Plugin tools, skills and UI reuse the existing Streamable HTTP MCP endpoint and signed Queue transport.
- Keep `pet_direct` as the canonical low-level direct contract and compatibility escape hatch.
- Prefer focused model-facing tools for recognizable user goals. Their metadata is part of behavior, not decoration.
- Keep server-side policy authoritative. Skills and UI can guide tool choice but cannot widen filesystem, process, network or publication authority.
- Keep structured tool data useful without UI. Optional UI renders authoritative server state; it does not become a second source of truth.
- Keep secrets out of plugin files. Current bearer/token compatibility remains until OAuth is deliberately added.

## Shipped foundation

- portable plugin beside the existing runtime,
- focused `confined-repo-work` skill plus `pet_workspace_inspect`, `pet_read_files` and `pet_session_finish`,
- `pet_direct` retained as the canonical low-level escape hatch,
- labelled golden prompts for routing checks,
- self-contained Pet Dispatcher Cockpit MCP App at `ui://pet-dispatcher/cockpit/v1`,
- global/sidebar and thread-panel entrypoints with worker/session/task state,
- target selection through Model-App Context,
- recent-task details, cancellation and finish-session controls using canonical server tools.

The remaining foundation task is periodic manual replay of the golden prompt set after meaningful metadata or host/model changes. Keep chat/Codex useful without the UI component.

## Phase 3 - structured delegation UX

Add a rich form for heavyweight delegation rather than exposing JSON plumbing:

- target;
- `inspect` vs `code`;
- free managed router vs DeepSeek work executor;
- timeout;
- only server-approved network profiles when network selection is eventually exposed.

The model must still be able to call the underlying tool directly.

Plugin settings are a natural home for durable user preferences such as default executor, default target/device, timeout and auto-session behavior. Settings must reference server-owned policy instead of duplicating it.

## Phase 4 - authentication

Move the primary plugin connection from shared bearer/token compatibility toward OAuth or Mixed Authentication on the existing Cloudflare Worker.

Candidate shape:

- Cloudflare Workers OAuth Provider Library;
- OAuth for consequential/private tools;
- unauthenticated initialize/tool discovery only if Mixed Authentication materially improves setup;
- keep the current bearer header and connector-token route as explicit compatibility paths during migration;
- never put credentials in `plugin.json`, `mcp.json`, skill files, tool metadata or UI state.

## Phase 5 - deeper extensions

Consider after the cockpit is useful:

- composer mentions for selecting a repository/task/session directly from the desktop composer;
- settings entrypoint;
- richer task/session deep links;
- additional focused facades only when golden prompts show recurring routing ambiguity.

Composer mentions are lower priority because current host support is narrower than sidebar/thread UI.

## MCP Tasks migration experiment

Pet Dispatcher already has durable `taskId`, status, result and cancellation semantics. Newer MCP specifications also define task-augmented tool calls plus `tasks/get`, `tasks/result` and `tasks/cancel`.

Do **not** replace `pet_task_get` / `pet_task_cancel` yet. First verify that the current ChatGPT/Codex plugin hosts consume MCP Tasks end to end with the behavior Pet Dispatcher needs. If verified, add a compatibility adapter and migrate incrementally rather than rewriting the Queue/DO lifecycle.

## Metadata evaluation

Treat metadata as a maintained product surface:

1. Keep `plugin/golden-prompts.json` labelled with direct, indirect and negative cases.
2. Change one metadata variable at a time when tuning routing.
3. Record whether the expected tool fired, arguments were sensible and confirmations matched the safety annotation.
4. Prefer high precision on negative cases before chasing marginal recall.
5. Re-run after adding tools, changing descriptions, or major host/model updates.

Longer-term production telemetry should count tool selection/failure patterns without logging secrets or unnecessary payloads.

## Multi-device future

The plugin should not hard-code the Legion forever. When Pet Dispatcher gains Android/other workers, expose device selection through the same control plane and keep device defaults in plugin settings or server-side user configuration. Do not create per-device plugin forks.
