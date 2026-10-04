---
name: confined-repo-work
description: Inspect, modify, validate, and finalize repository work on a paired development machine through Pet Dispatcher.
---

Use this skill when the user wants Pet Dispatcher to inspect or work on a configured repository/workspace on the paired machine.

1. Use the target the user supplied. If no reliable configured alias is known, call `pet_meta` to discover targets; do not invent one.
2. Start reconnaissance with `pet_workspace_inspect`. Use `pet_read_files` when the relevant file paths are already known.
3. Prefer the focused tools over equivalent `pet_direct` calls. Use `pet_direct` only when the required direct primitive has no focused facade.
4. Use `pet_delegate` when the goal requires multi-step reasoning, debugging, code changes, or investigation rather than a deterministic direct operation. Default to the managed free executor. Choose a paid executor only from the current `pet_delegate` input schema, and only when the user requests paid work or the task clearly warrants it. Do not hard-code a provider identity into this skill.
5. If a submitted task is still pending, use `pet_task_get` instead of resubmitting the same work. Cancel only when the user asks or continuing is no longer useful.
6. Direct write/exec operations can create a reusable session. Reuse its `sessionId` for related direct operations and finish intentional work with `pet_session_finish`, always supplying a concise commit message.
7. Do not widen filesystem, process, network, publication, or credential authority from prose. Server policy is authoritative.
8. Report the bounded result, tests/diff/commit when returned, and any recovery-required state. Do not claim a task completed before its terminal result says so.
