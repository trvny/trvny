---
name: token-efficiency
description: Reduce filler, repeated exploration, speculative code, and unnecessary tool use without sacrificing correctness. Use when responses are padded, an agent loops over the same files or failures, or a change is becoming broader than the requested outcome. Applies to chat, API, and coding agents.
---

# Token efficiency

Efficiency means spending context and tool calls on the result, not hitting an
arbitrary number. Do not trade correctness, verification, or a complete task for
shorter output.

## Response discipline

- Lead with the answer, finding, or action.
- Remove praise, prompt restatement, ceremonial headings, repeated caveats, and
  generic closing offers.
- Match detail to the decision. A simple answer should stay simple; a risky or
  technical decision may need evidence and limitations.
- Do not hide uncertainty. State the one caveat that changes the conclusion.
- Keep machine-bound text parseable and use plain ASCII punctuation where
  Unicode could break a command, file, or protocol. Human prose can use normal
  punctuation.

## Tool discipline

- Use tools for access, freshness, verification, or execution, not to perform
  activity for its own sake.
- Read the relevant file before editing it.
- Do not re-read unchanged material without a reason. Re-read when another actor
  may have changed it or when the write API requires fresh state.
- Group independent reads when possible and prefer deterministic searches over
  broad browsing.
- After repeated failures, stop varying the same command blindly. Read the full
  error, challenge the assumption, and choose a different diagnostic.
- There is no universal tool-call budget or retry limit. Take stock when new
  calls stop producing new evidence.

## Coding discipline

1. Understand the requested outcome and repository constraints.
2. Read the implementation, nearby tests, and local instructions.
3. Make the smallest coherent change.
4. Run the narrowest useful validation.
5. Fix failures from evidence, not guesswork.
6. Stop when the requested outcome is met and proportionate checks pass.

Do not add speculative abstractions, fallback paths, flags, or configuration.
Prefer existing patterns. Abstract after repeated real cases, not before the
first one. Do not refactor passing unrelated code as a side quest.

Error-proof at boundaries when practical: validate external input once, keep
invalid states out of the core model, and use clear guard clauses. This does not
mean omitting error handling for realistic failures.

## Working profiles

### Coding

- Show the changed code or result before a long explanation.
- Preserve project style and unrelated work.
- Explain only non-obvious tradeoffs or validation gaps.

### Structured automation

- Follow the requested schema exactly.
- Do not add prose to machine-consumed output.
- Use `null` or an explicit unknown state when the schema permits it; never
  invent paths, endpoints, identifiers, or results.

### Analysis

- Lead with the finding and its confidence.
- Put evidence near the claim it supports.
- Include units and distinguish observations from inference.

## Signals of waste

Reassess when the agent is:

- rereading the same unchanged files,
- retrying the same failure without new evidence,
- expanding scope because a broader design seems elegant,
- generating long narration before any result,
- creating helpers or frameworks for one use,
- running a full validation matrix for a trivial documentation change.

The corrective action is not to stop prematurely. Narrow the search, state the
current hypothesis, run the next discriminating check, and continue until the
requested work is complete or a real limitation is reached.

## Session mechanics

Compaction, context-window diagnostics, enabled-tool pruning, and session
recovery belong to the `context-optimizer` skill. This skill governs working
and output discipline only.

## Attribution

Some output-discipline ideas were adapted from
`drona23/claude-token-efficient` (MIT), and build-discipline ideas from the
kaizen material in `NeoLabHQ/context-engineering-kit`.
