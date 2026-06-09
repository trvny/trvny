---
name: chat-context
description: Keep long claude.ai conversations sharp and avoid burning through usage limits -- when to start a fresh chat vs keep going, how to use Projects for persistent context, setting durable preferences and styles instead of repeating yourself, attaching only what's relevant, and the summarize-and-handoff move when a thread gets bloated or starts forgetting earlier details. Use when a chat feels sluggish, repetitive, or forgetful, when starting a big multi-step task, or when the user asks how to make claude.ai sessions more efficient. For claude.ai chat (not Claude Code -- there are no slash commands or settings files here).
---

# Chat Context

Keep long claude.ai conversations sharp, and avoid spending limits re-establishing context. This is the chat-adapted version of a session-management skill. claude.ai has no `/compact`, `/context`, `settings.json`, or subagents, so the moves here are claude.ai-native.

## The biggest lever: new chat vs keep going

- **New, unrelated topic** -> start a new chat. A thread carries every prior turn with it, so doing fresh work inside a stale thread wastes context and can muddy the answers.
- **Continuing the same task** -> keep going in the same thread.

## When a thread gets long or degraded

Signs: Claude repeats itself, forgets details you established earlier, or answers drift toward generic.

The fix (the chat equivalent of compact-then-clear):
1. Ask: "Summarize where we are -- the decisions made and what's left."
2. Start a fresh chat (or a new chat inside the relevant Project) and paste that summary as the opening context.

You keep the thread of the work without dragging the whole bloated history along.

## Use the features built for persistence

- **Projects**: for ongoing or multi-chat work, put shared context (instructions, reference files) in a Project so it persists across chats without re-pasting each time.
- **User preferences**: durable preferences -- tone, format, standing constraints -- set once instead of repeated in every chat.
- **Styles**: for a consistent voice and format across responses.
- **Past-chat reference / memory** (if enabled in Settings): lets Claude draw on earlier conversations, so you re-explain less.

## Feed in only what's needed

- Attach the relevant file, or paste the relevant excerpt -- not an entire repo or a 90-page PDF -- when a section is enough to answer the question.
- Scope the prompt: a target ("in the auth section..."), constraints ("don't change the data model"), and acceptance criteria ("should return 429 after 5 attempts"). Vague prompts make Claude take in more than it needs to.

## Model choice

Match the model to the task: a stronger model for hard reasoning or large inputs, a lighter and faster one for simple back-and-forth. This affects both response speed and how fast you reach usage limits.

## A note for Claude

If the user is clearly doing unrelated new work inside a long thread, or a conversation is visibly degrading, it's fine to suggest starting fresh or moving into a Project -- once, briefly. Don't nag, and don't frame it as a way to keep them talking to Claude; the point is a better result for them.
