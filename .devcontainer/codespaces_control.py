#!/usr/bin/env python3
"""Narrow GPTomek/Actions adapter for the user's personal Codespaces."""

import json
import os
import re
import subprocess
import sys

REPO = "trvny/trvny"
OWNER = "trvny"
DISPLAY_NAME = "Travny AI Devbox"
BRANCH = "main"
ACTIONS = {"status", "ensure", "stop", "doctor", "agents"}
SSH_TASKS = {
    "doctor": "bash -lc 'cd /workspaces/trvny && bash .devcontainer/devbox doctor'",
    "agents": "bash -lc 'cd /workspaces/trvny && bash .devcontainer/devbox agents'",
}
CODESPACE_NAME = re.compile(r"^[a-zA-Z0-9-]{1,150}$")


def call(args: list[str], *, timeout: int = 60) -> str:
    result = subprocess.run(
        args, text=True, capture_output=True, timeout=timeout, check=False,
    )
    if result.returncode:
        # GH errors may include user data; do not expose stdout/stderr or credentials.
        raise RuntimeError(f"GitHub command failed (code {result.returncode})")
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
        raise RuntimeError(
            f"GitHub Codespaces API failed (code {result.returncode})"
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
    repository = api("GET", f"/repos/{REPO}")
    repo_id = repository.get("id")
    if type(repo_id) is not int:
        raise RuntimeError("Cannot identify repo; refusing Codespace mutation")
    result = api(
        "GET", f"/user/codespaces?repository_id={repo_id}&per_page=100"
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
            machine = select_machine()
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
            raise ValueError("Usage: codespaces_control.py <status|ensure|stop|doctor|agents>")
        run(sys.argv[1])
    except (RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"Devbox control: {exc}", file=sys.stderr)
        sys.exit(1)
