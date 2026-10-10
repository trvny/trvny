#!/usr/bin/env python3
"""Offline security and lifecycle tests for GPTomek Codespaces control."""

import io
import os
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
        with patch.object(control, "api", side_effect=[
            {"id": 42}, {"total_count": 4, "codespaces": payload},
        ]):
            matches = control.list_managed()
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["name"], "pocket-demo-codespace")

    def test_refuse_ambiguous_managed_codespaces(self):
        with patch.object(control, "api", side_effect=[
            {"id": 42}, {"codespaces": [codespace(), codespace()]},
        ]):
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
            if path == "/repos/trvny/trvny":
                return {"id": 42}
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

    def test_no_secret_is_logged_when_auth_missing(self):
        with patch.dict(os.environ, {"GH_TOKEN": ""}), \
            patch.object(control, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "not configured"):
                control.run("ensure")
            api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
