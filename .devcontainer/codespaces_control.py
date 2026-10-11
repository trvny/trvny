#!/usr/bin/env python3
"""Narrow GPTomek/Actions adapter for the user's personal Codespaces."""

import json
import os
import re
import subprocess
import sys

REPO = "trvny/trvny"
REPO_ID = 926010685  # Immutable GitHub repository ID; confirmed against public API
OWNER = "trvny"
DISPLAY_NAME = "Travny AI Devbox"
BRANCH = "main"
ACTIONS = {"status", "ensure", "stop", "doctor", "agents", "creation-log", "inspect", "repair"}
SSH_TASKS = {
    "inspect": (
        "bash --noprofile --norc -c '"
        "source /etc/os-release; printf \"os=%s\\n\" \"$ID\"; "
        "if test -d /workspaces/trvny/.git; then echo workspace=present; "
        "else echo workspace=missing; fi; "
        "if test -f /workspaces/trvny/.devcontainer/devcontainer.json; "
        "then echo devcontainer=present; else echo devcontainer=missing; fi; "
        "if test -d \"$HOME/.local/share/travny-devbox\"; "
        "then echo local_tools=present; else echo local_tools=missing; fi; "
        "if test -f \"$HOME/.local/share/travny-devbox/package.json\"; "
        "then echo node_manifest=present; else echo node_manifest=missing; fi; "
        "for tool in sudo apt-get curl gh node npm uv agy copilot hermes yt-dlp; do "
        "if command -v \"$tool\" >/dev/null 2>&1; then echo \"tool:$tool=present\"; "
        "else echo \"tool:$tool=missing\"; fi; done"
        "'"
    ),
    "doctor": "bash -lc 'cd /workspaces/trvny && bash .devcontainer/devbox doctor'",
    "agents": "bash -lc 'cd /workspaces/trvny && bash .devcontainer/devbox agents'",
}
# Fixed and guarded repair: never reset HEAD or touch unrelated workspace files.
# Uses the trusted public repository to avoid reading Codespace credentials.
REPAIR_SYNC_COMMAND = (
    "bash --noprofile --norc -c '"
    "set -eu; cd /workspaces/trvny; "
    "test \"$(git branch --show-current)\" = main "
    "|| { echo wrong_branch; exit 3; }; "
    "tmp=$(mktemp -d .devcontainer/.repair.XXXXXX); "
    "trap \"rm -rf \\\"$tmp\\\"\" EXIT; "
    "GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null "
    "git -C \"$tmp\" init -q; "
    "GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null "
    "git -C \"$tmp\" fetch -q --no-tags "
    "https://github.com/trvny/trvny.git main 2>/dev/null "
    "|| { echo fetch_failed; exit 4; }; "
    "for file in .devcontainer/devcontainer.json "
    ".devcontainer/setup.sh .devcontainer/devbox; do "
    "git -C \"$tmp\" show \"FETCH_HEAD:$file\" "
    "> \"$tmp/$(basename \"$file\")\"; "
    "if ! cmp -s \"$file\" \"$tmp/$(basename \"$file\")\"; then "
    "git show \"HEAD:$file\" > \"$tmp/original-$(basename \"$file\")\" "
    "|| { echo original_missing; exit 3; }; "
    "cmp -s \"$file\" \"$tmp/original-$(basename \"$file\")\" "
    "|| { echo local_changes; exit 3; }; "
    "fi; done; "
    "test \"$(git branch --show-current)\" = main "
    "|| { echo wrong_branch; exit 3; }; "
    "for file in .devcontainer/devcontainer.json "
    ".devcontainer/setup.sh .devcontainer/devbox; do "
    "mv \"$tmp/$(basename \"$file\")\" \"$file\"; "
    "done; echo devcontainer_updated'"
)

CODESPACE_NAME = re.compile(r"^[a-zA-Z0-9-]{1,150}$")


def call(args: list[str], *, timeout: int = 60) -> str:
    result = subprocess.run(
        args, text=True, capture_output=True, timeout=timeout, check=False,
    )
    if result.returncode:
        # Only fixed, non-secret repair rejection reasons may be echoed.
        safe_markers = {"wrong_branch", "local_changes", "fetch_failed", "original_missing"}
        reason = next(
            (line for line in result.stdout.splitlines() if line in safe_markers),
            "remote_error",
        )
        raise RuntimeError(
            f"GitHub command failed (code {result.returncode}; reason {reason})"
        )
    return result.stdout


def api(method: str, endpoint: str, body: dict | None = None) -> dict:
    if not endpoint.startswith(("/user/codespaces", "/repos/trvny/trvny")):
        raise ValueError("GitHub API endpoint out of Devbox scope")
    command = ["gh", "api", "-X", method, endpoint]
    if body is not None:
        command += ["--input", "-"]
    result = subprocess.run(
        command,
        input=json.dumps(body) if body is not None else None,
        capture_output=True, text=True, timeout=60, check=False,
    )
    if result.returncode:
        # Never disclose raw GitHub CLI stderr or response bodies: they can
        # contain private URLs or authentication details.
        label = (
            "repository lookup" if endpoint == f"/repos/{REPO}"
            else "personal Codespaces list"
            if endpoint.startswith("/user/codespaces?")
            else "machine catalog"
            if endpoint.endswith("/codespaces/machines")
            else "Codespaces lifecycle"
        )
        match = re.search(r"\bHTTP\s+([45]\d\d)\b", result.stderr)
        status = match.group(1) if match else "unknown"
        raise RuntimeError(
            f"GitHub API {label} failed (HTTP {status}; "
            f"CLI exit {result.returncode})"
        )
    return json.loads(result.stdout) if result.stdout.strip() else {}


def matching_codespace(item: dict) -> bool:
    return (
        item.get("repository", {}).get("full_name") == REPO
        and item.get("owner", {}).get("login") == OWNER
        and item.get("billable_owner", {}).get("login") == OWNER
        and item.get("display_name") == DISPLAY_NAME
    )


def list_managed() -> list[dict]:
    # A narrowly-scoped Codespaces token does not need generic repository
    # metadata permission. The returned objects are still checked against
    # exact personal owner, billing owner, display name and repository name.
    result = api(
        "GET", f"/user/codespaces?repository_id={REPO_ID}&per_page=100"
    )
    codespaces = result.get("codespaces", [])
    if not isinstance(codespaces, list):
        raise RuntimeError("Invalid Codespaces list")
    if result.get("total_count", len(codespaces)) > len(codespaces):
        raise RuntimeError("More Codespaces than one page; refusing mutation")
    found = [item for item in codespaces if matching_codespace(item)]
    if len(found) > 1:
        raise RuntimeError("More than one managed Devbox; manual selection required")
    return found


def select_machine() -> str:
    response = api("GET", f"/repos/{REPO}/codespaces/machines")
    machines = response.get("machines", [])
    # 4 vCPU; prefer smallest memory at or above 8 GiB.
    candidates = [
        machine for machine in machines
        if machine.get("cpus") == 4
        and 8 * 1024**3 <= machine.get("memory_in_bytes", 0) <= 16 * 1024**3
        and isinstance(machine.get("name"), str)
    ]
    if not candidates:
        raise RuntimeError("No suitable 4-vCPU machine available; not creating")
    candidates.sort(key=lambda m: m["memory_in_bytes"])
    return candidates[0]["name"]


def checked_name(codespace: dict) -> str:
    name = codespace.get("name", "")
    if not isinstance(name, str) or not CODESPACE_NAME.fullmatch(name):
        raise RuntimeError("Unexpected Codespace name")
    return name


def summary(codespace: dict) -> None:
    name = checked_name(codespace)
    state = codespace.get("state", "unknown")
    web_url = codespace.get("web_url", "")
    print(f"Devbox: {name} | state: {state}")
    if isinstance(web_url, str) and web_url.startswith("https://"):
        print(f"Open: {web_url}")


def run(action: str) -> None:
    if action not in ACTIONS:
        raise ValueError("Unsupported Codespaces action")
    if not os.environ.get("GH_TOKEN"):
        raise RuntimeError(
            "Secret DEVBOX_CODESPACES_TOKEN not configured in trvny/trvny Actions"
        )
    matches = list_managed()
    existing = matches[0] if matches else None

    if action == "status":
        if existing:
            summary(existing)
        else:
            print("No managed Devbox exists")
        return

    if action == "ensure":
        if not existing:
            print("Checking available personal Codespaces machine types", flush=True)
            machine = select_machine()
            print("Requesting personal Codespace creation", flush=True)
            created = api("POST", f"/repos/{REPO}/codespaces", {
                "ref": BRANCH,
                "machine": machine,
                "display_name": DISPLAY_NAME,
                "devcontainer_path": ".devcontainer/devcontainer.json",
                "idle_timeout_minutes": 15,
                "retention_period_minutes": 10080,
                "geo": "EuropeWest",
            })
            print("Codespace creation requested")
            summary(created)
        else:
            name = checked_name(existing)
            state = existing.get("state")
            if state in {"Shutdown", "Stopped"}:
                api("POST", f"/user/codespaces/{name}/start")
                print(f"Start requested for {name}")
            elif state in {"Available", "Starting", "Queued", "Rebuilding", "Provisioning"}:
                print(f"Devbox already exists; state: {state}")
            else:
                raise RuntimeError(f"Unknown state {state!r}; not starting")
            summary(existing)
        return

    if not existing:
        print("No managed Devbox exists")
        return
    name = checked_name(existing)
    state = existing.get("state")
    if action == "creation-log":
        # Creation log may contain secrets. Never print the raw log to Actions.
        log = call(["gh", "codespace", "logs", "-c", name], timeout=90)
        patterns = (
            "7zip", "oncreatecommand", "postcreatecommand",
            "setup.sh", "build failed", "exit code",
            "non-zero", "not found", "denied", "unable",
            "failed", "error",
        )
        lines = [
            line for line in log.splitlines()
            if any(marker in line.lower() for marker in patterns)
        ]
        print(f"Creation log: {len(log.splitlines())} lines, "
              f"{len(lines)} possible setup clues")
        for line in lines[-24:]:
            # Restrict output to line classification, not potentially sensitive
            # command arguments, URLs, tokens or raw environment variables.
            low = line.lower()
            label = next(
                (marker for marker in patterns if marker in low), "other"
            )
            print(f"  signal: {label}")
        if not lines:
            print("No obvious setup errors found. Check VS Code creation.log")
        return
    if action == "repair":
        if state != "Available":
            raise RuntimeError("Devbox must be running for scoped repair")
        print("Verifying a clean .devcontainer workspace", flush=True)
        result = call(
            ["gh", "codespace", "ssh", "-c", name, REPAIR_SYNC_COMMAND],
            timeout=120,
        )
        if "devcontainer_updated" not in result:
            raise RuntimeError("Configuration sync was not confirmed")
        print("Synced three tracked Devbox files from main", flush=True)
        print("Requesting existing Codespace container rebuild", flush=True)
        call(["gh", "codespace", "rebuild", "-c", name], timeout=480)
        print("Codespace rebuild command completed")
        return
    if action == "stop":
        if state in {"Shutdown", "Stopped"}:
            print("Devbox already stopped")
        else:
            api("POST", f"/user/codespaces/{name}/stop")
            print(f"Stop requested for {name}")
        return
    if state != "Available":
        raise RuntimeError("Devbox not ready; dispatch 'ensure' first")
    command = SSH_TASKS[action]
    # No user-supplied shell input. Only two predefined, read-only diagnostics.
    print(f"Running {action} in {name}", flush=True)
    output = call(["gh", "codespace", "ssh", "-c", name, command], timeout=180)
    print(output[-12000:])


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Usage: codespaces_control.py <status|ensure|stop|doctor|agents|creation-log|inspect|repair>")
        run(sys.argv[1])
    except (RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"Devbox control: {exc}", file=sys.stderr)
        sys.exit(1)
