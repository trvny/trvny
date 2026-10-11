#!/usr/bin/env python3
"""Guard the Codespaces bootstrap against optional installers breaking container creation."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent


class BootstrapSafetyTests(unittest.TestCase):
    def test_container_creation_does_not_install_optional_tools(self):
        config = json.loads((ROOT / "devcontainer.json").read_text())
        on_create = config["onCreateCommand"]
        post_create = config["postCreateCommand"]
        self.assertEqual(on_create, 'mkdir -p "$HOME/.local/bin"')
        self.assertTrue(post_create.startswith("bash .devcontainer/setup.sh all ||"))

    def test_failed_profile_does_not_skip_later_installs(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            fake_bin = Path(tmp) / "bin"
            fake_bin.mkdir()
            trace = Path(tmp) / "profiles.txt"
            fake_bash = fake_bin / "bash"
            fake_bash.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$2" >> "$PROFILE_TRACE"\n'
                '[ "$2" != base ]\n'
            )
            fake_bash.chmod(0o755)
            env = os.environ.copy()
            env.update({
                "HOME": str(home),
                "PATH": f"{fake_bin}:{env['PATH']}",
                "PROFILE_TRACE": str(trace),
            })
            result = subprocess.run(
                ["/bin/bash", str(ROOT / "setup.sh"), "all"],
                env=env, capture_output=True, text=True, timeout=10,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(trace.read_text().splitlines(), [
                "base", "antigravity", "browser", "media", "hermes",
            ])
            self.assertIn("bootstrap: base failed", result.stderr)

    def test_optional_profiles_are_isolated_and_reported(self):
        setup = (ROOT / "setup.sh").read_text()
        self.assertIn("for profile in base antigravity browser media hermes", setup)
        self.assertIn('if bash "$0" "$profile"; then', setup)
        self.assertIn("failures=$((failures + 1))", setup)
        self.assertIn("if (( failures > 0 )); then", setup)
        self.assertIn("exit 1", setup)
        self.assertIn("devbox install %s", setup)


if __name__ == "__main__":
    unittest.main()
