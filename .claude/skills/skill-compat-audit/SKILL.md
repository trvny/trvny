---
name: skill-compat-audit
description: Audit and fix skills for claude.ai / Skills API compatibility so they install and trigger correctly, especially when porting Claude Code skills to claude.ai chat. Checks the frontmatter against the upload allowlist (only name, description, license, allowed-tools, metadata, compatibility are accepted — everything else like context, agent, disable-model-invocation, model is rejected), enforces the name/description/SKILL.md rules, and rewrites Claude-Code-only assumptions (subagents, slash-command files, settings.json, claude -p, gh) into chat-equivalents. Use when a skill won't upload, an installed skill never triggers, or you're batch-auditing a folder of skills for claude.ai. Run quick_validate then package_skill from the skill-creator directory.
license: Complete terms in LICENSE.txt
---

# Skill Compatibility Audit (claude.ai / Skills API)

A skill that's fine in Claude Code can fail silently on claude.ai: it's **rejected on upload** (illegal frontmatter), **never triggers** (weak description), or **loads but misfires** (it assumes subagents, slash commands, or a filesystem that chat doesn't have). This audit catches all three. Use it on one skill or a whole directory.

## 1. Frontmatter — the upload allowlist (hard rule)

The validator accepts **exactly** these keys and rejects any others:

```
name          (required)   kebab-case ^[a-z0-9-]+$, ≤64 chars, no leading/trailing/double hyphen
description   (required)   ≤1024 chars, NO angle brackets (< or >)
license       (optional)
allowed-tools (optional)
metadata      (optional)   nested keys under it are fine
compatibility (optional)   string, ≤500 chars
```

Strip every other key. The common offenders when porting from Claude Code (or other harnesses) are `context` (e.g. `context: fork`), `agent`, `disable-model-invocation`, `model`, `color`, and tool-permission blocks under non-allowlisted names. They make the upload fail outright. Also:
- **One `SKILL.md` per skill**, at `<folder>/SKILL.md`. Nested `SKILL.md` files are rejected on upload (only Claude Code's filesystem loads them). Supporting docs must be renamed (`references/<topic>.md`).
- Angle brackets in `description` fail — rewrite `<thing>` as "thing" or "the X".

## 2. Description — does it actually trigger?

claude.ai only consults a skill based on its `description`, and Claude tends to **under-trigger**. A correct-but-shy description is a real defect. Make it do two jobs: what the skill does **and** when to use it (concrete trigger phrases, file types, contexts), phrased a little pushy. Move all "when to use this" out of the body and into the description. (If you want to optimize triggering quantitatively, that's the `skill-creator` description-optimizer — but its `run_loop.py` needs `claude -p`, which is Claude Code only.)

## 3. Body — rewrite Claude Code assumptions for chat

claude.ai chat has **no subagents, no slash commands, no settings.json, no `~/.claude`, no `claude` CLI, and no persistent local checkout**. Rewrite, don't just delete:
- **Subagent fan-out** ("spawn N agents in parallel") → do the steps inline, one at a time. The chat VM is single-threaded for this.
- **`/slash-command` references / command files** → describe the action in prose; chat skills are model-invoked by description, not by a command.
- **`gh ...`** → the **github connector** (`github:get_file_contents`, `github:create_or_update_file`, `github:push_files`, `github:list_*`). There's no `gh` token in chat. For private repos, connector-only — `git clone` in the sandbox has no auth and works only for public repos. Never paste a token into chat.
- **`claude -p` / eval-runner loops / browser eval-viewer** → not available; rely on inline review.
- **Filesystem persistence between sessions** → none; don't assume prior outputs survive.
- A bash sandbox **does** exist (git/npm/python3/curl, empty start), so local checks are fine to suggest — just gated on a public clone or connector reads.

State the environment once at the top (a short blockquote like the `cmd-*` skills use) so the model picks the right path.

## 4. Validate and package

Run from the skill-creator directory (`/mnt/skills/examples/skill-creator`). Copy any **read-only installed skill to a writable location first** (`/tmp/<name>/`), edit there, and **preserve the original `name`** and folder so the output is `<name>.skill`, not `<name>-v2`.

```bash
cd /mnt/skills/examples/skill-creator
python -m scripts.quick_validate /tmp/<skill-folder>     # fix until it prints "Skill is valid!"
python -m scripts.package_skill  /tmp/<skill-folder>     # produces the .skill for upload at claude.ai/skills
```

`quick_validate` enforces everything in §1 — treat a failure as the spec, not a suggestion.

## 5. Batch audit a folder

For a directory of skills, go one at a time so a single failure doesn't hide the rest:

```bash
for d in <skills-dir>/*/; do
  echo "== $d"; python -m scripts.quick_validate "$d"
done
```

Group the output: which pass, which have illegal frontmatter (list the offending keys), which trigger weakly, which carry Claude-Code-only assumptions. Fix in that priority order (upload-blockers first), re-validate, then repackage each. Report a short table of skill → issues → fix, and hand back the validated `.skill` files.

## Guardrails

- The allowlist is the contract — if `quick_validate` rejects a key, remove it; don't argue with it.
- Don't rename a skill you're fixing (breaks the user's installed reference); preserve `name` and folder.
- Don't strip body content that's still useful in chat — translate it. Deleting the subagent section wholesale can remove the actual method; replace it with the inline equivalent.
- A skill that uploads but never fires is still broken — always sanity-check the description's triggers, not just legality.
