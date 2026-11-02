#!/usr/bin/env python3
"""Post DeepSource findings to one stable GitHub PR comment."""

import json
import os
import re
import sys
from urllib.request import Request, urlopen

MARKER = "<!-- deepsource-pr-findings:v1 -->"
QUERY = """
query ($sha: String!) {
  run(commitOid: $sha) {
    runUid
    checks(first: 30) {
      edges {
        node {
          analyzer { name }
          issues(first: 100) {
            totalCount
            edges {
              node {
                path beginLine severity shortcode title isSuppressed
              }
            }
          }
        }
      }
    }
  }
}
"""


def get_json(url, token, method="GET", payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = Request(url, data=body, method=method, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "travny-deepsource-pr-reporter",
    })
    with urlopen(req, timeout=25) as response:
        return json.load(response)


def format_report(repo, sha, run):
    found, hidden = [], 0
    for edge in run["checks"]["edges"]:
        check = edge["node"]
        connection = check["issues"]
        issues = [e["node"] for e in connection["edges"]]
        hidden += max(0, (connection["totalCount"] or 0) - len(issues))
        for issue in issues:
            if not issue["isSuppressed"]:
                found.append((check["analyzer"]["name"], issue))
    found.sort(key=lambda x: (
        {"CRITICAL": 0, "MAJOR": 1, "MINOR": 2}.get(x[1]["severity"].upper(), 3),
        x[1]["path"], x[1]["beginLine"],
    ))
    lines = [MARKER, "### DeepSource findings: " + sha[:7], ""]
    lines.append(f"{len(found)} findings" + (f" (+{hidden} not shown)" if hidden else "") + ".")
    lines.append("")
    for analyzer, issue in found[:150]:
        path, line = issue["path"], issue["beginLine"]
        title = " ".join((issue["title"] or "Unnamed issue").split())
        code = issue["shortcode"] or "AI"
        link = f"https://github.com/{repo}/blob/{sha}/{path}#L{line}"
        lines.append(f"- **{issue['severity'].lower()}** {analyzer} [{path}:{line}]({link}): {code} · {title}")
    if len(found) > 150:
        lines.append(f"- And {len(found) - 150} more findings.")
    lines.extend(["", f"[Full DeepSource analysis](https://app.deepsource.com/gh/{repo}/run/{run['runUid']}/)",
                  "", "_Updated automatically from the DeepSource API._"])
    return "\n".join(lines), len(found) + hidden


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    sha = os.environ["TARGET_SHA"].strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Full 40-character TARGET_SHA required")
    github_token = os.environ["GITHUB_TOKEN"]
    gh = "https://api.github.com/repos/" + repo
    prs = get_json(f"{gh}/commits/{sha}/pulls?per_page=100", github_token)
    prs = [p for p in prs if p["state"] == "open" and p["head"]["sha"] == sha
           and p["head"]["repo"]["full_name"] == repo]
    if not prs:
        print("No open same-repository PR on this commit")
        return

    data = get_json("https://api.deepsource.com/graphql/", os.environ["DEEPSOURCE_PAT"],
                    "POST", {"query": QUERY, "variables": {"sha": sha}})
    if data.get("errors"):
        raise RuntimeError("DeepSource GraphQL query rejected: " + json.dumps(data["errors"]))
    run = (data.get("data") or {}).get("run")
    if not run:
        raise RuntimeError("No DeepSource run for this SHA")
    report, count = format_report(repo, sha, run)

    for pr in prs:
        number = pr["number"]
        previous = None
        for page in range(1, 11):
            batch = get_json(f"{gh}/issues/{number}/comments?per_page=100&page={page}",
                             github_token)
            for comment in batch:
                if (comment["user"]["login"] == "github-actions[bot]"
                        and MARKER in comment["body"]):
                    previous = comment
            if len(batch) < 100:
                break
        if count == 0 and previous is None:
            print(f"PR #{number}: no findings")
            continue
        if count == 0:
            report = MARKER + "\n### DeepSource clear on " + sha[:7] + " ✅"
        if previous:
            if previous["body"] != report:
                get_json(f"{gh}/issues/comments/{previous['id']}", github_token,
                         "PATCH", {"body": report})
                print(f"PR #{number}: report updated")
        else:
            get_json(f"{gh}/issues/{number}/comments", github_token,
                     "POST", {"body": report})
            print(f"PR #{number}: report created")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, KeyError, TypeError) as exc:
        print(f"::error::DeepSource reporter: {exc}", file=sys.stderr)
        sys.exit(1)
