#!/usr/bin/env python3
"""Drain GPTomek Issue mailbox commands through the independent PR transport."""

from __future__ import annotations

from collections import Counter
import base64
import json
import os
import re
import subprocess
import sys
import time

CONTROL_REPOSITORY = "trvny/trvny"
CONTROL_ISSUE = 203
FALLBACK_PR = 176
MAX_EVENT_COMMANDS = 20
POLL_ATTEMPTS = 25
POLL_SECONDS = 1

COMMAND_RE = re.compile(
    r"<!--\s*gptomek-command:[A-Za-z0-9+/_-]+={0,2}\s*-->"
)
COMMAND_PREFIX_RE = re.compile(r"<!--\s*gptomek-command:")
RESULT_RE = re.compile(
    r"<!--\s*gptomek-result:[A-Za-z0-9+/_-]+={0,2}\s*-->"
)


class MailboxError(RuntimeError):
    pass


def gh_json(path: str, *, method: str | None = None, payload: object | None = None) -> dict:
    command = ["gh", "api"]
    if method:
        command.extend(["--method", method])
    command.append(path)

    data = None
    if payload is not None:
        command.extend(["--input", "-"])
        data = json.dumps(payload)

    completed = subprocess.run(
        command,
        input=data,
        text=True,
        capture_output=True,
        check=False,
        env=os.environ,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "gh api failed"
        raise MailboxError(detail)
    if not completed.stdout.strip():
        return {}
    return json.loads(completed.stdout)


def markers(body: str) -> list[str]:
    found = COMMAND_RE.findall(body)
    prefixes = len(COMMAND_PREFIX_RE.findall(body))
    if prefixes != len(found):
        raise MailboxError("mailbox contains a malformed GPTomek command marker")
    return found


def issue() -> dict:
    return gh_json(f"repos/{CONTROL_REPOSITORY}/issues/{CONTROL_ISSUE}")


def fallback_pr() -> dict:
    return gh_json(f"repos/{CONTROL_REPOSITORY}/pulls/{FALLBACK_PR}")


def patch_issue(body: str) -> None:
    gh_json(
        f"repos/{CONTROL_REPOSITORY}/issues/{CONTROL_ISSUE}",
        method="PATCH",
        payload={"body": body},
    )


def patch_fallback(body: str) -> None:
    gh_json(
        f"repos/{CONTROL_REPOSITORY}/pulls/{FALLBACK_PR}",
        method="PATCH",
        payload={"body": body},
    )


def marker_payload(marker: str, kind: str) -> dict:
    match = re.fullmatch(
        rf"<!--\s*gptomek-{kind}:([A-Za-z0-9+/_-]+={{0,2}})\s*-->",
        marker,
    )
    if not match:
        raise MailboxError(f"malformed GPTomek {kind} marker")
    encoded = match.group(1)
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise MailboxError(f"invalid GPTomek {kind} marker payload") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
        raise MailboxError(f"GPTomek {kind} marker is missing a command id")
    return payload


def matching_result(body: str, command_id: str) -> str | None:
    for match in RESULT_RE.finditer(body):
        marker = match.group(0)
        if marker_payload(marker, "result")["id"] == command_id:
            return marker
    return None


def wait_for_result(command_id: str) -> tuple[str, str]:
    for _ in range(POLL_ATTEMPTS):
        body = str(fallback_pr().get("body") or "")
        result_marker = matching_result(body, command_id)
        if result_marker:
            return body, result_marker
        time.sleep(POLL_SECONDS)
    raise MailboxError(
        f"fallback PR #{FALLBACK_PR} did not record a matching GPTomek result "
        f"for command {command_id!r} within {POLL_ATTEMPTS * POLL_SECONDS} seconds"
    )


def normalized_with_result(body: str, result_marker: str) -> str:
    clean = RESULT_RE.sub("", body)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    return "\n\n".join(part for part in (clean, result_marker) if part)


def event_markers(event_path: str) -> list[str]:
    with open(event_path, encoding="utf-8") as handle:
        payload = json.load(handle)
    body = str((payload.get("issue") or {}).get("body") or "")
    found = markers(body)
    if not found:
        raise MailboxError("command marker missing from event payload")
    if len(found) > MAX_EVENT_COMMANDS:
        raise MailboxError(
            f"event contains {len(found)} commands; limit is {MAX_EVENT_COMMANDS}"
        )
    return found


def still_present(body: str, marker: str) -> bool:
    return marker in markers(body)


def remaining_from_snapshot(snapshot: list[str], live: list[str]) -> list[str]:
    counts = Counter(live)
    remaining: list[str] = []
    for marker in snapshot:
        if counts[marker] > 0:
            remaining.append(marker)
            counts[marker] -= 1
    return remaining


def main() -> int:
    if len(sys.argv) != 2:
        raise MailboxError("usage: gptomek-mailbox-fallback.py <github-event-path>")

    snapshot = event_markers(sys.argv[1])
    retained_results: dict[str, str] = {}
    consumed = 0
    stale = 0

    for index, marker in enumerate(snapshot, start=1):
        live = str(issue().get("body") or "")
        if not still_present(live, marker):
            print(f"[{index}/{len(snapshot)}] marker already cleared or superseded; skipping")
            stale += 1
            continue

        command_id = marker_payload(marker, "command")["id"]
        print(
            f"[{index}/{len(snapshot)}] forwarding command {command_id!r} "
            f"through PR #{FALLBACK_PR}"
        )
        patch_fallback(marker)
        fallback_body, result_marker = wait_for_result(command_id)

        fallback_markers = markers(fallback_body)
        if fallback_markers and fallback_markers != [marker]:
            raise MailboxError("fallback PR contains an unexpected command marker")

        retained = bool(fallback_markers)

        current = str(issue().get("body") or "")
        if not still_present(current, marker):
            print(f"[{index}/{len(snapshot)}] Issue mailbox changed; preserving newer state")
            stale += 1
            continue

        if not retained:
            current = current.replace(marker, "", 1)
            consumed += 1
        else:
            retained_results[marker] = result_marker
            print(f"[{index}/{len(snapshot)}] retryable command retained in Issue mailbox")

        patch_issue(normalized_with_result(current, result_marker))

    live_body = str(issue().get("body") or "")
    remaining = remaining_from_snapshot(snapshot, markers(live_body))

    if remaining:
        first = remaining[0]
        if first in retained_results:
            patch_issue(normalized_with_result(live_body, retained_results[first]))
        print(
            f"GPTomek fallback drained {consumed} command(s); "
            f"{len(remaining)} retryable/stale command(s) from this event remain.",
            file=sys.stderr,
        )
        return 1

    print(
        f"GPTomek fallback drained {consumed} command(s); "
        f"{stale} command(s) were already cleared or superseded."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (MailboxError, json.JSONDecodeError) as error:
        print(f"GPTomek fallback failed: {error}", file=sys.stderr)
        raise SystemExit(1)
