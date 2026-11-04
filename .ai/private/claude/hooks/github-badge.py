#!/usr/bin/env python3
"""Claude Code badge on GitHub posts made from cloud sessions.

Entry points, one file:
  github-badge.py install  cloud setup: gh symlink in ~/.local/bin + PreToolUse entry in settings.json
  github-badge.py hook     PreToolUse hook for GitHub/Claudiusz MCP write tools (stdin JSON)
  gh ...                   via that symlink, ahead of the real gh; rewrites --body/--body-file

Contract shared with gh-apps/claudiusz/src/badge.ts: MARKER = already badged, skip;
OPT_OUT = no badge (posts written as the user), marker stripped.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from itertools import pairwise

MARKER = "<!-- claude-badge -->"
OPT_OUT = "<!-- no-badge -->"
OPT_OUT_RE = re.compile(re.escape(OPT_OUT) + r"\n?")
# Logo: assets/claudecode-color.png (trvny/trvny), base64 data URI.
BADGE = "[![Claude Code](https://img.shields.io/badge/Claude_Code-262624?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAKACAMAAAA7EzkRAAAAFVBMVEVMaXHZd1fZd1babUjZd1faf1rZd1epRaWRAAAABnRSTlMAXawH8g5t5RLrAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFOklEQVR42u3WUQ6EIAxAQcDV%2Bx95r1Bjk2Kdid81wkMdAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADebtHa9gFedPYTIAIUoAAFiAAFKEABIkABClCACFCAAhQgAkSAAkSACFCACBABChABIkABIkAEKEAEiAAFiAARoAARIAIUIAJEgAJEgAhQgAgQAQoQASJAAQpQgAhQgAIUIAIUoAAFiAAFKEABIkABClCACBABChABIkABIkAEKEAEiAAFiAARoAARIAIUIAJEgAJEgAhQgAgQAQoQASJAASJABChABIgABShAASJAAQpQgAhQgAIUIAIUoAAFiAARoAARIAIUIAJEgAJEgAhQgAjwnjNmfq2EGVwYAT4UvO33AqzZDwEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoACTHTHfCzC4MNkBHsnGBYUEiAARIAgQAYIAESAIEAGCABEgCBABggARIAgQAYIAESAIEAGCABEgCBABggARIAgQAYIAESAIEAEiQBAgAgQBIkAQIAIEASJAECACBAEiQBAgAgQBIkAQIAIEASJAECACBAEiQBAgAgQBIkAQIAIEASJABAgCRIAgQAQIAkSAIEAECAJEgCBABAgCRIDwNMCVzJL2lt3LyGaLmr%2BxdmeLBChABIgABYgAEaAAESACFCACRIACRIAIUIAIEAEKEAEiQAEiQAQoQASIAAWIABGgABEgAhQgAkSAAhSgABGgAAUoQAQoQAEKEAEKUIACRIAIUIAIEAEKEAEiQAEiQAQoQASIAAWIABGgABEgAhQgAkSAAkSACFCACBABChABIkABIkAEKEABChABClCAAkSAAhSgABGgAAUoQAQoQAEKEAEiQAEiQAQoQASIAAWIABGgABEgAhQgAkSAAkSACDDJjFnRBy6aVyb6HKto3mhiJp%2B4W%2FOOXa8bX5CZ%2FEVqU9YbAuzwCyNAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKcEvnDCqaV3cyg86ieQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwJv8Af3P8SOrUE9bAAAAAElFTkSuQmCC)](https://claude.com/claude-code)"

# MCP write tools whose `body` is a post. Inline pending-review comments left out (noise).
MCP_TOOLS = {
    "add_issue_comment", "update_issue_comment", "issue_write", "create_pull_request",
    "update_pull_request", "add_reply_to_pull_request_comment", "pull_request_review_write",
    "discussion_comment_write",
    # claudiusz
    "comment", "edit_comment", "reply_review_comment", "review", "discussion_comment",
}
GH_POSTS = {("pr", "create"), ("pr", "comment"), ("pr", "edit"), ("pr", "review"),
            ("issue", "create"), ("issue", "comment"), ("issue", "edit")}


def badge(body):
    if not body.strip():
        return body
    if OPT_OUT in body:
        return OPT_OUT_RE.sub("", body)  # marker only; authored whitespace kept
    if MARKER in body:
        return body
    return f"{MARKER}\n{BADGE}\n\n{body}"


def hook():
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    if not tool.startswith("mcp__") or tool.rsplit("__", 1)[-1] not in MCP_TOOLS:
        return
    args = dict(data.get("tool_input") or {})
    body = args.get("body")
    if not isinstance(body, str) or not body.strip():
        return  # no body: never add a badge-only one
    if OPT_OUT in body and "laudiusz" in tool:
        return  # Claudiusz strips the opt-out itself; stripping here would make it badge
    new = badge(body)
    if new != body:
        args["body"] = new
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedInput": args}}))


def real_gh():
    me = os.path.realpath(__file__)
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, "gh")
        if os.path.isfile(p) and os.access(p, os.X_OK) and os.path.realpath(p) != me:
            return p
    sys.exit("gh shim: real gh not found on PATH")


def rewrite(argv, temps):
    words = [a for a in argv if not a.startswith("-")][:4]  # tolerate -R owner/repo first
    if not any(pair in GH_POSTS for pair in pairwise(words)):
        return argv
    out, i = list(argv), 0
    while i < len(out):
        a = out[i]
        if a in ("-b", "--body") and i + 1 < len(out):
            out[i + 1] = badge(out[i + 1])
            i += 2
            continue
        if a.startswith("--body="):
            out[i] = "--body=" + badge(a[len("--body="):])
        elif a in ("-F", "--body-file") and i + 1 < len(out):
            out[i + 1] = badged_file(out[i + 1], temps)
            i += 2
            continue
        elif a.startswith("--body-file="):
            out[i] = "--body-file=" + badged_file(a[len("--body-file="):], temps)
        i += 1
    return out


def badged_file(path, temps):
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(path, encoding="utf-8") as src:
            text = src.read()
    fd, tmp = tempfile.mkstemp(prefix="gh-body-", suffix=".md")
    temps.append(tmp)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(badge(text))
    return tmp


def shim():
    gh = real_gh()
    temps = []
    try:
        args = rewrite(sys.argv[1:], temps)
    except (OSError, UnicodeError) as e:  # never block gh on a badge problem
        print(f"gh shim: badge skipped ({e})", file=sys.stderr)
        args = sys.argv[1:]
    if not temps:
        os.execv(gh, [gh, *args])
    try:  # child, so badged body-file copies get removed
        code = subprocess.run([gh, *args], check=False).returncode
    finally:
        for t in temps:
            os.unlink(t)
    sys.exit(code)


# Connector names vary: mcp__github__, mcp__claude_ai_Claudiusz-MCP__, mcp__plugin_github_claudiusz__.
MATCHER = "^mcp__.*([Gg]it[Hh]ub|[Cc]laudiusz)"


def install():
    me = os.path.realpath(__file__)
    os.chmod(me, 0o700)  # owner-only; exec via symlink
    bindir = os.path.expanduser("~/.local/bin")
    os.makedirs(bindir, exist_ok=True)
    link = os.path.join(bindir, "gh")
    ours = os.path.islink(link) and os.path.realpath(link) == me
    if os.path.lexists(link) and not ours:
        print(f"github-badge: {link} is not the shim, left alone; gh posts stay unbadged", file=sys.stderr)
    else:
        if ours:
            os.remove(link)
        os.symlink(me, link)
        if shutil.which("gh") != link:
            print(f"github-badge: {link} not first on PATH, gh posts stay unbadged", file=sys.stderr)
    path = os.path.expanduser("~/.claude/settings.json")
    try:
        with open(path, encoding="utf-8") as f:
            settings = json.load(f)
    except FileNotFoundError:
        settings = {}
    pre = settings.setdefault("hooks", {}).setdefault("PreToolUse", [])
    pre[:] = [e for e in pre if "github-badge" not in json.dumps(e)]  # idempotent
    pre.append({"matcher": MATCHER, "hooks": [{"type": "command", "command": f"python3 {me} hook", "timeout": 10}]})
    with open(path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"github-badge: gh shim {link}, hook in {path}")


if __name__ == "__main__":
    if os.path.basename(sys.argv[0]) == "gh":
        shim()
    elif sys.argv[1:] == ["hook"]:
        hook()
    elif sys.argv[1:] == ["install"]:
        install()
    else:
        sys.exit(__doc__)
