# Botek Control Center

## Goal

Expose a small Telegram Mini App that makes Botek a control surface for the existing backend instead of inventing a parallel one.

The first useful slice is Legion / Pet Dispatcher: show whether the device is fresh or stale, when it last reported metadata, active sessions/processes, and a bounded list of recent tasks with their current state and result summary.

## Architecture

- `pet-dispatcher-control` remains the source of truth for device metadata and individual task state.
- A bounded recent-task index is maintained only as a query accelerator; canonical task state still lives in each task Durable Object.
- `travny-tg-assistant` reads Pet Dispatcher through the existing `TelegramAssistantEntrypoint` service binding.
- The Mini App is served by the existing Telegram assistant Worker, not a separate service.
- Mini App API requests are owner-only and validate `Telegram.WebApp.initData` server-side with the existing bot token.
- The browser never receives Pet Dispatcher credentials or direct service-binding access.

## MVP surface

The Mini App opens on a Legion card with device state, last update, active sessions/processes and configured repositories/workspaces. A recent-tasks section shows task ID, status, timestamps and bounded summary/error text. The first version is read-mostly; task cancellation/delegation can reuse existing Botek commands and callbacks before write controls are added to the Mini App.
