# Field notes

Anyone working in this repository writes notes **here**. The rest of `memory/`
is exported from a local store and read-only here. Each file has one authoring
side, preventing merge conflicts and silent drift.

Record hard-won findings others would need to re-derive: measurements, disproved
hypotheses, decisions with reasons, or traps that look like bugs but are not.
Do not log what you just did; the commit message and diff already do.

A note may later enter the local store. **Promotion is a move, not a copy:**
remove it here in the same change; it returns as an exported note in the parent.
Keeping the original would give one fact two authoring locations.

Prefer notes that explain how to re-check them. Date anything that can go stale;
name the command or file that settles it.

## How

One file per fact, `kebab-case.md`, with this frontmatter:

```markdown
---
name: <same as the filename, without .md>
description: <one line — this is what a future reader scans>
metadata:
  node_type: memory
  type: project | reference | feedback
---

<the fact, then how to verify it>
```

`node_type: memory` matches the local store, so promotion needs no format fix.

Link related notes as `[[name]]`. `../README.md` defines resolution: links
outside this directory and the exported notes point into the unreachable local
store. That is expected, not broken.

**No index, by design.** Parallel agents would edit the shared index and conflict
even on unrelated notes, defeating this write-back design. Discover notes by
filename and `description`:

```bash
grep -h --exclude=README.md '^description:' .ai/private/claude/memory/field-notes/*.md
```

`--exclude=README.md` is required; otherwise the scan reports this template's
`description:` placeholder as a note.

The description replaces an index entry. Make it one line that helps a reader
judge relevance.

## When you are a delegated agent

Write a note only if the task says so or the next agent would waste the same
hour on your finding. Mention it in your final report. Do not correct exported
notes in the parent; the next export would lose the fix. Report the correction
for a source fix instead.
