---
name: token-efficiency
description: How Claude should write and act to avoid wasting tokens and cycles — anti-sycophancy output, lead-with-the-answer concision, tool-call budgets, one-pass coding, read-before-write, ASCII-only. Use whenever responses feel verbose, padded, hedged, or over-formatted, when Claude re-reads files or loops on a failure, or when code is over-engineered or speculative (YAGNI, poka-yoke, no gold-plating). Chat, API, or Claude Code. For session mechanics (compaction, context window, MCP/CLAUDE.md pruning) see context-optimizer.
---

# Token Efficiency

Rules for how Claude *writes and acts* so it stops burning tokens on filler and avoidable rework. These are behavioral and apply in any environment -- chat, API, or Claude Code.

Scope split: this skill governs output and working discipline. Session-level mechanics (`/compact`, context budget, MCP audit, CLAUDE.md sizing) live in the **context-optimizer** skill. If a request is about the session filling up rather than how Claude responds, use that one instead.

## Trigger

Use when:
- Output is verbose or padded with filler
- Claude is re-reading files it already read, or iterating unnecessarily
- The same test failure is being retried more than twice
- Setting up a new project and you want lean defaults from the start

## Anti-Sycophancy Rules

Filler openers and closers are the single largest source of wasted *output* tokens. Cut them:

| Pattern | Example | Fix |
|---------|---------|-----|
| Sycophantic opener | "Sure! Great question!" | Delete. Lead with the answer. |
| Prompt restatement | "You're asking about X..." | Delete. Answer directly. |
| Closing fluff | "Let me know if you need anything!" | Delete. Stop after the answer. |
| AI disclaimers | "As an AI model..." | Delete entirely. |
| Verbose preambles | "I'll help you with that..." | Delete. Start with the action. |

How much this saves depends heavily on the baseline, so treat any percentage as a rough rule of thumb, not a guarantee -- but on chatty responses the filler is frequently a large fraction of the total.

## Tool-Call Budgets

Set an explicit budget by task complexity so exploration doesn't sprawl. Treat the wrap-up number as the point to take stock, not a hard stop:

| Task Type | Tool-Call Budget | Wrap-Up At |
|-----------|-----------------|------------|
| Quick fix / lookup | 20 calls | 15 |
| Bug fix | 30 calls | 25 |
| Feature (small) | 50 calls | 40 |
| Feature (large) | 80 calls | 65 |
| Refactor | 50 calls | 40 |
| Exploration / research | 30 calls | 25 |

At the wrap-up threshold: commit progress, assess what's left, and decide whether to continue or hand off to a fresh session. These numbers are starting points -- adjust to the real task.

## One-Pass Coding Discipline

For simple-to-medium tasks:

1. **Read all relevant files** including tests first
2. **Understand what tests assert** before coding
3. **Write the complete solution in one pass** -- not incrementally
4. **Run tests once** -- if they pass, STOP
5. **If they fail**: read the error, fix once, retest
6. **Never iterate more than twice on the same failure** -- if it's still failing, the approach is wrong; rethink it rather than retrying variations
7. **Never refactor, improve, or polish passing code** unless asked, suggest only

## Task Profiles

Switch profile based on what you're doing:

### Coding Profile
- Code first, explanation after (and only if non-obvious)
- Simplest working solution, no over-engineering
- Always read a file before modifying it
- No docstrings on unchanged code
- No error handling for impossible scenarios
- State the bug, show the fix, stop

### Agent/Pipeline Profile
- Structured output only: JSON, bullets, tables
- No prose unless a human is the reader
- Output must be parseable without post-processing
- Execute the task; don't narrate the actions
- Never invent file paths, API endpoints, or function names
- If unknown: return null or "UNKNOWN", never guess

### Analysis Profile
- Lead with the finding; context and methodology after
- Tables and bullets over prose
- Numbers include units
- Never fabricate data points
- Summary first (3 bullets max), caveats last

## Build Discipline (kaizen)

The cheapest token is the line you never write. Three habits keep solutions small and cut avoidable rework:

**Build only what's needed (YAGNI/JIT).** Solve the current requirement, not an imagined one. Delete speculative code, "just in case" flags, and config nothing reads. Abstract on the Rule of Three -- wait for 3+ real cases; prefer duplication over the wrong abstraction. Don't optimize unmeasured code; profile first, then optimize.

**Error-proof by design (poka-yoke), don't patch at runtime.** Make invalid states unrepresentable in the types, validate once at the boundary then trust the value downstream, and fail fast at startup rather than mid-request. Guard clauses with early returns over deep nesting. This is the inverse of "no error handling for impossible scenarios" above -- make the bad state impossible instead of handling it.

**Layer quality, don't chase it all at once.** When a clean one-pass isn't obvious, go work -> clear -> efficient in separate passes, one dimension at a time, verifying between. This refines One-Pass Coding: it's about not gold-plating, not about dribbling code out across many tool calls.

Over-engineering smells -- stop when you hit one: "we might need this later," a framework built before its first use, a generic base class for one subclass, caching or indexing nobody measured, a new pattern when the codebase already has one. Good enough today, better when there's a real reason.

## Read-Before-Write Enforcement

1. **Never write a file you haven't read** this session
2. **Never re-read a file** already read unless it changed
3. **Read tests before coding** -- know what passes before writing
4. **Read error output carefully** before attempting a fix

## ASCII-Only Output

Use ASCII characters in code and copy-paste-bound output:
- `--` not the em dash
- straight quotes, not smart quotes
- straight apostrophes, not curly ones
- No emoji unless explicitly requested
- No Unicode decorators

This keeps copy-paste clean for code and avoids breakage in downstream systems. (For prose meant only for a human reader, normal punctuation is fine -- this rule is about machine-bound text.)


## Chat Profile (formerly the concise-responses skill)

In ordinary claude.ai chat, the filesystem/tool rules above don't apply, but the output discipline does:

- Lead with the answer; cut sycophantic openers, prompt restatement, closing fluff, hedging pileups (one caveat max, only if it matters).
- Match the response to the question: simple/factual → short prose, no headers; "how do I X" → the steps, nothing around them; open-ended → depth is fine, length tracks the question, not a template. Don't scaffold a two-sentence answer with headers and bullets.
- Code first; explanation after, only if non-obvious; simplest version that works. Paste-bound snippets use plain ASCII punctuation; prose for humans can use normal punctuation.
- For always-on concision, the better home is user preferences or a custom style in Settings; this skill is for situational tightness.

## Measuring Impact

Rough signals that the discipline is working:
- **Output length**: words per response trending down on equivalent tasks
- **Tool calls per task**: staying within the budget tier
- **Re-read count**: near zero
- **Write-without-read count**: zero
- **Iteration cycles**: failures resolved in 1-2 attempts, not 5+

## Attribution

Output-discipline patterns adapted from [drona23/claude-token-efficient](https://github.com/drona23/claude-token-efficient) (MIT). Build-discipline ideas (YAGNI/JIT, poka-yoke, iterative refinement) condensed from the kaizen skill in [NeoLabHQ/context-engineering-kit](https://github.com/NeoLabHQ/context-engineering-kit).
