# Botek Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a Telegram Mini App control center whose first working view reports Legion/Pet Dispatcher status and recent tasks.

**Architecture:** Pet Dispatcher keeps canonical device/task state and adds a bounded recent-task index for read access. The existing Telegram assistant Worker validates Telegram Mini App init data and exposes a tiny owner-only JSON API plus static UI. No new backend service or task transport is introduced.

**Tech Stack:** Cloudflare Workers, Durable Objects, Service Bindings, TypeScript, native HTML/CSS/JS, Telegram Mini Apps API.

**Spec:** `tg-bots/CONTROL_CENTER.md`

**Status (2026-09-21):** Tasks 1-3 are implemented and merged. Task 4 is the maintained follow-up backlog; the unchecked items below are intentional remaining work.

## Global Constraints

- Keep `pet-dispatcher-control` the source of truth for device metadata and task state.
- Treat the recent-task list as a bounded secondary index only.
- Reuse `TelegramAssistantEntrypoint`; never expose Pet Dispatcher credentials to the browser.
- Validate `Telegram.WebApp.initData` on the server and fail closed to the configured owner.
- Add no frontend framework or runtime dependency for the MVP.

---

### Task 1: Bounded recent-task index

**Files:** `mcp/pet-dispatcher/control-plane/entry.ts`, focused tests under `mcp/pet-dispatcher/tests/`.

- [x] Write a failing test proving recent snapshots are newest-first, deduplicated by task ID and bounded.
- [x] Implement the minimal pure index helper and run the focused test green.
- [x] Wire task init/state transitions to update the index and expose `recentTasks(limit)` on `TelegramAssistantEntrypoint`.
- [x] Run Pet Dispatcher typecheck, focused tests and control-plane dry-run.
- [x] Open a focused PR and merge only after final CI/review is clean.

### Task 2: Owner-only Mini App API

**Files:** `tg-bots/cloudflare-assistant/src/mini-app.ts`, `src/types.ts`, `src/index.ts`, focused tests.

- [x] Write failing tests for Telegram `initData` HMAC validation, auth-date freshness and owner ID enforcement.
- [x] Implement validation using Web Crypto and the existing `TELEGRAM_BOT_TOKEN` / `OWNER_TELEGRAM_USER_ID`.
- [x] Extend the Pet Dispatcher binding type with `recentTasks(limit)` and add a read-only `/mini-app/api/status` route.
- [x] Return only bounded device metadata and recent task summaries; use `cache-control: no-store`.
- [x] Run Telegram assistant typecheck and tests, then open and review a separate PR.

### Task 3: Telegram-native Control Center UI

**Files:** `tg-bots/cloudflare-assistant/src/mini-app-ui.ts`, `src/index.ts`, `src/telegram.ts` or menu-sync helper, focused tests.

- [x] Write a failing test for the HTML shell and its API/bootstrap contract.
- [x] Serve a dependency-free responsive Mini App at `/mini-app` using Telegram theme CSS variables and `telegram-web-app.js`.
- [x] Render Legion freshness, last report, sessions/processes, repositories/workspaces and recent task cards with compact states.
- [x] Add explicit refresh and safe empty/error states; no direct task mutation in MVP.
- [x] Sync an owner-visible Bot Menu Button to the Mini App URL through the existing `/start` / `/help` configuration path.
- [x] Run final Telegram CI-equivalent checks and open the UI PR.

### Task 4: Follow-up controls after read-only MVP

- [x] Reuse the existing task-cancellation API for active-task controls in the Mini App.
- [x] Require owner-authenticated requests plus an explicit confirmation before cancellation.
- [ ] Add task creation/delegation controls only when there is a clear Mini App workflow for them; keep Pet Dispatcher as the control backend.
- [ ] Add other read-mostly panels (providers, GitHub, feeds, memory) one concern per PR rather than creating a second control backend.
