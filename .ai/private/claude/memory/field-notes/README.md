# Field notes

Notes written **here**, by whoever was working in this repository. The rest of
`memory/` flows the other way — exported from a local store and read-only at
this end. Nothing is ever written from both sides, which is what keeps either
direction free of merge conflicts and silent drift.

Write one when you establish something that cost real work and would otherwise
have to be re-derived: a measurement, a disproved hypothesis, a decision and its
reason, a trap that looks like a bug but is not. Do not write one for what you
just did — the commit message and the diff already record that.

A note may later be promoted into the local store. **Promotion is a move, not a
copy:** the note leaves this directory in the same change, and comes back as an
exported note in the parent. Leaving the original here would give one fact two
authoring locations, which is the exact thing the two-direction split exists to
prevent.

A note is worth more when it says how to check it again. Date anything that can
go stale, and name the command or the file that settles it.

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

`node_type: memory` matches the local store's format, so promoting a note is a
copy rather than a copy plus a fix.

Link related notes as `[[name]]`. The parent `../README.md` is authoritative on
what a link resolves against; the short version is that anything outside this
directory and the exported notes points into a local store you cannot reach,
which is expected rather than broken.

**There is no index here, on purpose.** A shared index file is the one thing two
agents working in parallel would both have to edit, and it would conflict even
when their notes are unrelated — which is exactly the write-back design this is
supposed to avoid. Discovery goes through the filenames and the `description`
line instead:

```bash
grep -h --exclude=README.md '^description:' .ai/private/claude/memory/field-notes/*.md
```

`--exclude=README.md` is not optional: the template above contains a matching
`description:` line, so without it the scan reports this file's placeholder as
though it were a note.

So the description carries the weight an index entry would have. Write it as the
one line you would want to read when scanning for whether this note is relevant.

## When you are a delegated agent

Writing a note is in scope only if the task said so, or if you hit something the
next agent would waste the same hour on. Say in your final report that you added
one. Do not edit the exported notes in the parent directory to correct them —
that fix would be lost on the next export; report the correction instead and it
will be made at the source.
