#!/usr/bin/env python3
"""Offline security and lifecycle tests for GPTomek Codespaces control."""

import io
import os
import subprocess
from contextlib import redirect_stdout
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codespaces_control as control  # noqa: E402


def codespace(*, state="Available", owner="trvny", billable="trvny", repo="trvny/trvny"):
    return {
        "name": "pocket-demo-codespace",
        "owner": {"login": owner},
        "billable_owner": {"login": billable},
        "repository": {"full_name": repo},
        "display_name": control.DISPLAY_NAME,
        "state": state,
        "web_url": "https://pocket-demo-codespace.github.dev",
    }


class ControlTests(unittest.TestCase):
    def test_reject_unrecognized_action_without_network(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), patch.object(control, "api") as api:
            with self.assertRaises(ValueError):
                control.run("delete")
            api.assert_not_called()

    def test_list_only_personal_repo_codespace(self):
        payload = [
            codespace(repo="travnie/aistee"),
            codespace(owner="someone-else"),
            codespace(billable="travnie"),
            codespace(),
        ]
        with patch.object(control, "api", return_value={
            "total_count": 4, "codespaces": payload,
        }) as api_mock:
            matches = control.list_managed()
        api_mock.assert_called_once_with(
            "GET", "/user/codespaces?repository_id=926010685&per_page=100"
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["name"], "pocket-demo-codespace")

    def test_refuse_ambiguous_managed_codespaces(self):
        with patch.object(control, "api", return_value={
            "codespaces": [codespace(), codespace()],
        }):
            with self.assertRaisesRegex(RuntimeError, "More than one"):
                control.list_managed()

    def test_machine_requires_four_cores_and_at_least_eight_gib(self):
        machines = [
            {"name": "tiny", "cpus": 2, "memory_in_bytes": 8 * 1024**3},
            {"name": "large", "cpus": 8, "memory_in_bytes": 16 * 1024**3},
            {"name": "4core16gb", "cpus": 4, "memory_in_bytes": 16 * 1024**3},
            {"name": "4core8gb", "cpus": 4, "memory_in_bytes": 8 * 1024**3},
        ]
        with patch.object(control, "api", return_value={"machines": machines}):
            self.assertEqual(control.select_machine(), "4core8gb")

    def test_ensure_creates_only_a_personal_devbox(self):
        calls = []
        def mock_api(method, path, body=None):
            calls.append((method, path, body))
            if path.startswith("/user/codespaces?"):
                return {"codespaces": []}
            if path.endswith("/codespaces/machines"):
                return {"machines": [
                    {"name": "4core16gb", "cpus": 4, "memory_in_bytes": 16 * 1024**3}
                ]}
            if method == "POST":
                return codespace()
            raise AssertionError(f"Unexpected call: {method} {path}")
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "api", side_effect=mock_api), \
            redirect_stdout(io.StringIO()):
            control.run("ensure")
        writes = [(method, path, data) for method, path, data in calls if method == "POST"]
        self.assertEqual(len(writes), 1)
        method, path, body = writes[0]
        self.assertEqual(path, "/repos/trvny/trvny/codespaces")
        self.assertEqual(body["machine"], "4core16gb")
        self.assertEqual(body["ref"], "main")
        self.assertEqual(body["idle_timeout_minutes"], 15)
        self.assertEqual(body["display_name"], control.DISPLAY_NAME)
        self.assertEqual(body["geo"], "EuropeWest")

    def test_existing_stopped_devbox_starts_not_duplicates(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed", return_value=[codespace(state="Shutdown")]), \
            patch.object(control, "api", return_value={}) as api, \
            redirect_stdout(io.StringIO()):
            control.run("ensure")
        api.assert_called_once_with("POST", "/user/codespaces/pocket-demo-codespace/start")

    def test_stop_sends_only_pinned_name(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed", return_value=[codespace()]), \
            patch.object(control, "api", return_value={}) as api, \
            redirect_stdout(io.StringIO()):
            control.run("stop")
        api.assert_called_once_with("POST", "/user/codespaces/pocket-demo-codespace/stop")

    def test_no_remote_shell_user_argument(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed", return_value=[codespace()]), \
            patch.object(control, "call", return_value="OK") as shell, \
            redirect_stdout(io.StringIO()):
            control.run("agents")
        command = shell.call_args.args[0]
        self.assertEqual(command[:5], [
            "gh", "codespace", "ssh", "-c", "pocket-demo-codespace"
        ])
        self.assertEqual(command[5], control.SSH_TASKS["agents"])
        self.assertNotIn("GH_TOKEN", command[5])

    def test_repair_refuses_uncommitted_devcontainer_changes(self):
        command = control.REPAIR_SYNC_COMMAND
        self.assertIn('git -C "$tmp" init -q', command)
        self.assertIn('git -C "$tmp" fetch -q --no-tags', command)
        self.assertIn('git -C "$tmp" show', command)
        self.assertIn("git show \"HEAD:$file\"", command)
        self.assertIn("original_missing", command)
        self.assertNotIn("git diff", command)
        self.assertIn("mktemp -d .devcontainer/.repair.XXXXXX", command)
        nested = command.split("'")[1]
        syntax = subprocess.run(
            ["bash", "-n", "-c", nested],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        self.assertIn("local_changes", command)
        self.assertIn("https://github.com/trvny/trvny.git main", command)
        self.assertNotIn("git restore", command)
        self.assertNotIn("reset --hard", command)
        self.assertNotIn("git clean", command)
        self.assertNotIn("git checkout -f", command)

    def test_repair_syncs_only_then_rebuilds_existing_codespace(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed", return_value=[codespace()]), \
            patch.object(control, "call", side_effect=[
                "devcontainer_updated\n", "",
            ]) as runner, redirect_stdout(io.StringIO()):
            control.run("repair")
        self.assertEqual(runner.call_count, 2)
        self.assertEqual(runner.call_args_list[0].args[0][:5], [
            "gh", "codespace", "ssh", "-c", "pocket-demo-codespace",
        ])
        self.assertEqual(runner.call_args_list[1].args[0], [
            "gh", "codespace", "rebuild", "-c", "pocket-demo-codespace",
        ])

    def test_repair_does_not_rebuild_if_sync_fails(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed", return_value=[codespace()]), \
            patch.object(control, "call", side_effect=RuntimeError("dirty")) as runner, \
            redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "dirty"):
                control.run("repair")
        self.assertEqual(runner.call_count, 1)

    def test_hermes_retry_uses_only_verified_repo_install_script(self):
        command = control.HERMES_RETRY_COMMAND
        self.assertIn("raw.githubusercontent.com/trvny/trvny/main/.devcontainer/install-hermes.sh", command)
        self.assertIn('bash "$tmp"', command)
        self.assertNotIn("bash .devcontainer/setup.sh hermes", command)
        self.assertNotIn("cmp -s", command)
        self.assertNotIn("reset --hard", command)
        self.assertNotIn("github_token", command.lower())
        self.assertNotIn("git clean", command)
        syntax = subprocess.run(
            ["bash", "-n", "-c", command],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)

    def test_hermes_retry_is_bounded_and_fixed(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed", return_value=[codespace()]), \
            patch.object(control, "call", return_value="hermes_installed") as runner, \
            redirect_stdout(io.StringIO()):
            control.run("hermes-retry")
        runner.assert_called_once_with(
            ["gh", "codespace", "ssh", "-c", "pocket-demo-codespace",
             control.HERMES_RETRY_COMMAND],
            timeout=660,
        )

    def test_hermes_retry_refuses_stopped_machine(self):
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
            patch.object(control, "list_managed",
                         return_value=[codespace(state="Shutdown")]), \
            patch.object(control, "call") as runner:
            with self.assertRaisesRegex(RuntimeError, "must be running"):
                control.run("hermes-retry")
        runner.assert_not_called()

    def test_inspect_is_fixed_and_not_from_mutable_checkout(self):
        command = control.SSH_TASKS["inspect"]
        self.assertIn("workspace=missing", command)
        self.assertIn("devcontainer=missing", command)
        self.assertNotIn("bootstrap_probe.sh", command)
        self.assertNotIn("cd /workspaces/trvny", command)
        self.assertNotIn("id -un", command)
        self.assertIn("bash --noprofile --norc -c", command)
        self.assertNotIn("bash -lc", command)

    def test_creation_log_never_echoes_raw_lines_or_secrets(self):
        raw = (
            "onCreateCommand failed, ghp_EXAMPLE_PRIVATE_TOKEN\n"
            "E: Unable to locate package 7zip\n"
        )
        with patch.dict(os.environ, {"GH_TOKEN": "testing"}), \
             patch.object(control, "list_managed", return_value=[codespace()]), \
             patch.object(control, "call", return_value=raw) as read, \
             redirect_stdout(io.StringIO()) as output:
            control.run("creation-log")
        self.assertEqual(
            read.call_args.args[0][:3], ["gh", "codespace", "logs"]
        )
        self.assertIn("Creation log:", output.getvalue())
        self.assertNotIn("ghp_EXAMPLE_PRIVATE_TOKEN", output.getvalue())
        self.assertNotIn("Unable to locate", output.getvalue())

    def test_api_failure_reports_safe_status_and_step(self):
        import subprocess

        fake = subprocess.CompletedProcess(
            args=["gh"], returncode=1, stdout="",
            stderr="gh: Bad credentials (HTTP 401) token=PRIVATE_SECRET",
        )
        with patch.object(control.subprocess, "run", return_value=fake):
            with self.assertRaises(RuntimeError) as raised:
                control.api("GET", "/user/codespaces?repository_id=42")
        message = str(raised.exception)
        self.assertIn("personal Codespaces list", message)
        self.assertIn("HTTP 401", message)
        self.assertNotIn("PRIVATE_SECRET", message)

    def test_no_secret_is_logged_when_auth_missing(self):
        with patch.dict(os.environ, {"GH_TOKEN": ""}), \
            patch.object(control, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "not configured"):
                control.run("ensure")
            api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
