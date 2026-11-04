#!/usr/bin/env python3
"""Claude Code badge on GitHub posts made from cloud sessions.

Two entry points, one file:
  github-badge.py hook   PreToolUse hook for GitHub/Claudiusz MCP write tools (stdin JSON)
  gh ...                 symlinked as gh ahead of the real one; rewrites --body/--body-file

Contract shared with gh-apps/claudiusz/src/badge.ts: MARKER = already badged, skip;
OPT_OUT = no badge (posts written as the user), marker stripped.
"""
import json
import os
import re
import sys
import tempfile

MARKER = "<!-- claude-badge -->"
OPT_OUT = "<!-- no-badge -->"
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
        return body.replace(OPT_OUT, "").strip()
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


def rewrite(argv):
    words = [a for a in argv if not a.startswith("-")][:4]  # tolerate -R owner/repo first
    if not any(pair in GH_POSTS for pair in zip(words, words[1:])):
        return argv
    out, i = list(argv), 0
    while i < len(out):
        a = out[i]
        if a in ("-b", "--body") and i + 1 < len(out):
            out[i + 1] = badge(out[i + 1]); i += 2; continue
        if a.startswith("--body="):
            out[i] = "--body=" + badge(a[len("--body="):])
        elif a in ("-F", "--body-file") and i + 1 < len(out):
            out[i + 1] = badged_file(out[i + 1]); i += 2; continue
        elif a.startswith("--body-file="):
            out[i] = "--body-file=" + badged_file(a[len("--body-file="):])
        i += 1
    return out


def badged_file(path):
    text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    fd, tmp = tempfile.mkstemp(prefix="gh-body-", suffix=".md")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(badge(text))
    return tmp


def shim():
    gh = real_gh()
    try:
        args = rewrite(sys.argv[1:])
    except Exception as e:  # never block gh on a badge problem
        print(f"gh shim: badge skipped ({e})", file=sys.stderr)
        args = sys.argv[1:]
    os.execv(gh, [gh] + args)


if __name__ == "__main__":
    if os.path.basename(sys.argv[0]) == "gh":
        shim()
    elif sys.argv[1:] == ["hook"]:
        hook()
    else:
        sys.exit(__doc__)
