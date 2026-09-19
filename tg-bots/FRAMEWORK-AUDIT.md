# Telegram framework audit

Audited on 2026-09-19 against Botek's current Cloudflare Workers
implementation.

This is not a migration plan. The useful part of the Go frameworks is their
architecture and UX patterns, not the Go runtime itself. Botek should stay on
the existing TypeScript + Cloudflare stack unless a separate Go bot has a
concrete reason to exist.

## Sources

- [go-telegram/bot](https://github.com/go-telegram/bot)
- [Telebot](https://github.com/go-telebot/telebot)
  (the old `tucnak/telebot` project continues there)
- [Teleflow](https://github.com/kslamph/teleflow)
- [Telego](https://github.com/mymmrac/telego)
- [enetx/tg](https://github.com/enetx/tg)

At audit time, `go-telegram/bot` explicitly tracks Telegram Bot API 10.3.
Telego aims for a one-to-one Bot API mapping and includes handler, webhook,
conversation/FSM and test examples. Teleflow focuses on typed multi-step
flows, automatic state, named transitions and callback-data indirection.
Telebot emphasizes concise routing, middleware and callback ergonomics.
`enetx/tg` combines typed handlers, middleware, FSMs, rich messages,
ephemeral messages and fluent builders.

## What Botek already has

Do not rebuild these just because a framework has a nicer abstraction:

- webhook ingress with Telegram secret verification;
- Queue-backed update processing, retries and DLQ;
- update-id deduplication and ambiguous-send protection;
- owner/private/group permission boundaries;
- command handling, callback queries and inline mode;
- bounded conversation state in Durable Objects;
- media, albums, voice, polls, checklists and Business/Secretary handling;
- native keyboards, message editing, reactions and Rich Messages;
- Telegram-specific 429/retry handling;
- reminders, task notifications and proactive condition watches;
- Pet Dispatcher handoff for heavy/local work.

The framework audit is therefore mostly about reducing Botek's growing
routing complexity and making new multi-step UX safer.

## Patterns worth stealing

### 1. Typed update router and predicate handlers

**Borrow from:** Telego, go-telegram/bot, Telebot, enetx/tg.

Botek's `buildTelegramReply` currently owns a large sequence of callback,
command and message-type branches. Keep the same behavior, but gradually move
matching into a small typed router:

- match update kind first: callback, message, inline, service update;
- allow predicates such as private owner, group owner, command, media kind;
- first matching handler wins unless a route explicitly composes;
- keep domain logic in the existing focused modules;
- preserve Queue and Durable Object boundaries outside the router.

The goal is not a generic framework. It is a compact internal dispatch table
that makes adding one Telegram feature stop growing one giant function.

**Status:** callback routing implemented as the first slice. Expand the same
typed first-match router to owner message/command routing next; keep media and
domain handlers in their existing focused modules.

### 2. Small middleware pipeline

**Borrow from:** Telebot, go-telegram/bot, Telego, enetx/tg.

Use middleware only for cross-cutting rules that are currently easy to repeat:

- owner and chat-scope authorization;
- callback acknowledgement;
- bounded input checks;
- lightweight observability and timing;
- per-handler rate or single-flight guards where Telegram UX needs them.

Middleware must remain explicit and typed. Do not hide model calls,
Pet Dispatcher delegation or security-sensitive side effects behind magic
global middleware.

A useful Telebot idea is automatic callback acknowledgement so a forgotten
`answerCallbackQuery` cannot leave Telegram's spinner hanging.

**Worth implementing:** yes, together with the router.

### 3. Durable conversational flows / FSM

**Borrow from:** Teleflow, Telego conversation examples, enetx/tg FSM.

Add a tiny Botek-native flow abstraction for genuinely multi-step jobs.
Candidate workflows:

- configure a recurring briefing;
- build a watcher through buttons instead of command syntax;
- guided task creation with repo, profile and confirmation;
- future approval flows for Secretary/Business actions;
- Mini App actions that continue in chat.

Desired primitives:

- `Next`, `Retry`, `End`, `GoTo(step)`;
- typed flow data;
- explicit cancel and timeout;
- flow version for safe deploys;
- resumable state stored in a Durable Object;
- one active flow per chosen scope, for example chat/topic;
- clear escape hatch back to ordinary chat.

Do **not** copy in-memory user sessions from server frameworks. A Worker can
move between isolates, so durable state is mandatory for anything that must
survive requests.

**Worth implementing:** yes, after the router.

### 4. Opaque callback payload registry

**Borrow from:** Teleflow's large callback-data mechanism.

Telegram callback data is intentionally small. Richer Botek workflows should
not start packing repo names, task parameters, serialized state or secrets
into `callback_data`.

Use short opaque callback tokens:

```text
button -> cb:<short-id>
             |
             v
     Durable Object payload
```

Payload records should be bounded, owner-scoped, expiring and single-use when
appropriate. This also makes buttons easier to invalidate after a task or
approval expires.

Existing short callback formats such as task refresh IDs can stay as-is until
they need richer data.

**Worth implementing:** yes, with the flow layer.

### 5. Bot API completeness / drift check

**Borrow from:** Telego's one-to-one API goal and generated API surface,
plus go-telegram/bot's explicit Bot API version tracking.

Botek intentionally models only the Telegram types and methods it uses.
That is good for bundle size, but it makes new Bot API features easy to miss.

Add a lightweight maintenance check, not a runtime dependency:

- record the Bot API version last reviewed by Botek;
- periodically compare Telegram release notes with Telego and
  go-telegram/bot changelogs;
- update the capability backlog when a new update type or method is useful;
- add a focused type/method only when Botek has a workflow for it.

Do not chase 100% API coverage just for a green completeness number.

**Worth implementing:** yes, low-cost maintenance automation.

### 6. Injectable Telegram transport and Bot API test harness

**Borrow from:** Telego's test-server examples and the frameworks' transport
abstractions.

Botek already has many pure tests. The next useful testing layer is a small
fake Telegram API transport for contract tests around:

- webhook parsing and secret verification;
- callback acknowledgement;
- 429 + `retry_after`;
- deterministic 4xx vs ambiguous network failures;
- message edit fallback;
- media/file metadata;
- command/menu synchronization.

Keep the fake local to tests. Production should still call the hosted Telegram
Bot API through the existing transport.

**Worth implementing:** yes, especially before more Business actions.

### 7. Tiny builders for repeated Telegram UI

**Borrow from:** Telebot, Telego utilities and enetx/tg fluent builders.

Do not create a fluent DSL for every Telegram method. Add helpers only where
Botek repeatedly hand-builds the same structures, for example:

- inline keyboard rows and buttons;
- callback buttons with style;
- common reply/edit options;
- Rich Message blocks used by several reports.

Prefer small functions returning the existing Botek types over a new object
hierarchy.

**Worth implementing:** opportunistically.

## Patterns to leave on the shelf

These are useful in general-purpose frameworks but do not solve a current
Botek problem:

- rewriting Botek in Go;
- long polling for the always-on Cloudflare bot;
- in-memory FSM/session stores;
- dynamic runtime handler registration/unregistration;
- hosting many bots in one process;
- Telegram Stars/payments without a real product workflow;
- automatic admin/group behavior broader than the existing owner boundary;
- local Bot API server without a concrete large-file/local-hosted need;
- adopting a whole framework only to get keyboard helpers.

## Suggested implementation order

1. Extract a typed internal update router from `buildTelegramReply`.
2. Add a very small middleware layer for owner scope, callback ACK and guards.
3. Add durable typed flows with timeout/cancel/version semantics.
4. Add opaque callback payload storage for richer buttons and approvals.
5. Add Bot API version/drift tracking to maintenance docs or automation.
6. Add a fake Telegram transport for API contract tests.
7. Add UI builders only when repetition justifies them.

This order intentionally improves the internal spine before adding more
Telegram features. It should make the existing roadmap cheaper to extend,
rather than creating another framework-shaped subsystem beside it.
