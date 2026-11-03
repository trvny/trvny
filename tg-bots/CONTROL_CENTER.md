# Botek Control Center

## Goal

Expose a small Telegram Mini App that makes Botek a control surface for the existing backend instead of inventing a parallel one.

The first useful slice is Legion / Pet Dispatcher: show whether the device is fresh or stale, when it last reported metadata, active sessions/processes, and a bounded list of recent tasks with their current state and result summary.

## Architecture

- `pet-dispatcher-control` remains the source of truth for device metadata and individual task state.
- A bounded recent-task index is maintained only as a query accelerator; canonical task state still lives in each task Durable Object.
- `tg-assistant` reads Pet Dispatcher through the existing `TelegramAssistantEntrypoint` service binding.
- The Mini App is served by the existing Telegram assistant Worker, not a separate service.
- Mini App API requests are owner-only and validate `Telegram.WebApp.initData` server-side with the existing bot token.
- The browser never receives Pet Dispatcher credentials or direct service-binding access.

## Current surface

The owner-only Mini App shows Legion state and recent Pet Dispatcher tasks, including task cancellation. Watchtower lists active reminders and non-Secretary GitHub/Feedseek/Legion watches, with cancellation and independently bounded reads. Business/Secretary idle-watch internals remain excluded. Codebench, Streambench and Docbench are currently external `openLink` tiles, not native Mini App tools.

## Future surface

The **canonical feature plan** is in [CONCEPT.md](CONCEPT.md#interactive-bench-integrations-replace-link-only-tiles): integrated Docbench Draft Studio, Streambench radio player, Codebench utilities and other chat-to-Mini-App workflows. This file maintains only Control Center implementation boundaries; do not copy the feature backlog here.

For native workflows, keep Botek's existing authentication and backend ownership. Prefer scoped in-app actions over wrapping a separate Bench website in an unrestricted iframe, and return results to Telegram via the existing send pipeline.
