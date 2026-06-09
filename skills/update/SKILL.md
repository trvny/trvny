---
name: update
description: Sync tasks and refresh memory from your current activity in claude.ai chat. Use when the user wants to pull new assignments from a connected project tracker (Asana, Linear, Jira, GitHub Issues) into a task list, triage stale or overdue tasks, fill memory gaps for unknown people or projects, or run a comprehensive scan across connected chat, email, calendar, and docs to catch todos they haven't captured. Trigger on "update my tasks", "what am I forgetting", "catch me up", "sync my todos", or "refresh your memory about my work".
---

# Update

Keep the user's task list and your memory of their work current — in claude.ai chat, using connectors, your memory tool, and past-conversation search.

> **Environment note.** This is the claude.ai-chat version. There are no slash commands, no `TASKS.md` file on disk, and no `memory/` directory. The durable task list lives wherever the user keeps it (a connected tracker, or an artifact you maintain and they save), and "memory" means your memory tool, not files. If you're in Claude Code or Cowork instead, a file-based variant of this workflow applies there; here, follow the steps below.

Two modes:
- **Default** — sync tasks from connected sources, triage stale items, fill memory gaps.
- **Comprehensive** — also deep-scan recent activity (chat, email, calendar, docs) for missed todos and new entities. Triggered by "comprehensive", "deep scan", "everything", or "what am I missing".

## Where state lives in chat

- **Task list.** There's no persistent `TASKS.md`. Options, in order of preference: (1) a connected tracker (Asana/Linear/Jira/GitHub Issues) — the source of truth when present; (2) a markdown **artifact** you produce and the user keeps/pastes back next time; (3) for short-lived triage, just inline in the conversation. If the user references "my task list" and it isn't in this chat, search past conversations (`conversation_search` / `recent_chats`) before saying you can't find it.
- **Memory.** Use the memory tool to view and update what you know about the user's people, projects, and glossary. Confirm before writing. Never store secrets (tokens, passwords, SSNs).
- **Connectors.** Check what's actually connected before assuming a source exists. If a useful tracker/mail/calendar connector isn't connected, search the registry and offer it rather than guessing.

## Default mode

### 1. Load current state
Pull the current task list from the connected tracker if there is one. Otherwise ask the user to paste their list (or point at the artifact/past chat that holds it). View your memory for the people/projects/glossary you already have.

### 2. Sync tasks from connected sources
Check connected task sources:
- **Project tracker** (Asana, Linear, Jira) via its connector, if connected.
- **GitHub Issues** via the `github:*` tools (e.g. `github:list_issues` / `github:search_issues` filtered to the user) — **not** `gh issue list`; the CLI isn't authed in chat.

Fetch open/in-progress tasks assigned to the user and diff against the known list:

| External task | In known list? | Action |
|---|---|---|
| Found, not listed | No | Offer to add |
| Found, already listed | Yes (fuzzy title match) | Skip |
| Listed, not external | No | Flag as possibly stale |
| Completed externally | Still listed active | Offer to mark done |

Present the diff and let the user decide. Never auto-add or auto-complete.

### 3. Triage stale items
Flag tasks that are past due, have sat active a long time, or have no context (no person, no project). For each: done? reschedule? drop? Let the user choose.

### 4. Decode tasks for memory gaps
For each task, try to resolve every entity (people, projects, acronyms, tools, links) against your memory. Track which are known and which are gaps. Example: a task like "Send PSR to Todd re: Phoenix blockers" — "PSR" and "Todd" may be in memory; "Phoenix" may not be.

### 5. Fill gaps
Group the unknown terms and ask about them together:
```
A few terms in your tasks I don't have context for:
1. "Phoenix" (from "Send PSR to Todd re: Phoenix blockers") — what's Phoenix?
2. "Maya" (from "sync with Maya on API design") — who's Maya?
```
Write the answers to memory (people, projects, glossary) after confirming.

### 6. Capture enrichment
Tasks often carry richer context than memory holds. Pull out and (after confirmation) save: links, status changes ("launch done" → update project status), relationships ("Todd's sign-off on Maya's proposal"), and deadlines.

### 7. Report
Summarize concisely:
```
Update complete:
- Tasks: +3 from Asana, 1 completed, 2 flagged stale
- Memory: 2 gaps filled, 1 project enriched
```
If you maintained a task-list artifact, present the updated version so the user can save it.

## Comprehensive mode

Everything in default mode, plus a scan of recent activity across **connected** sources:
- **Chat/email** — search recent messages and sent mail via the relevant connector.
- **Calendar** — recent and upcoming events.
- **Docs** — recently touched files (e.g. Google Drive).
- **Past Claude conversations** — `recent_chats` / `conversation_search` for commitments you made or things the user said they'd do.

Then:

**Flag missed todos.** Compare activity against the known list and surface untracked action items, each with its source, and let the user pick which to add:
```
Possible missing tasks:
1. From email (Jun 2): "I'll send the updated mockups by Friday" → add?
2. From chat (Jun 1): "I'll review the API spec this week" → add?
```

**Suggest new memories.** Surface entities that recur in activity but aren't in memory (people, projects/topics), grouped by confidence. Offer high-confidence ones directly; ask about low-confidence ones. Also flag stale memories (a project with no recent mentions) for cleanup.

## Rules
- Never add tasks or write memory without confirmation.
- Preserve source links when available.
- Fuzzy-match task titles so minor wording differences don't create duplicates.
- Prefer the connected tracker as source of truth; fall back to artifact, then inline.
- Use `github:*` tools and other connectors — never assume an authed `gh`/CLI in chat.
