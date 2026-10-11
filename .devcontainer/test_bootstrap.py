#!/usr/bin/env python3
"""Guard the Codespaces bootstrap against optional installers breaking container creation."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent


class BootstrapSafetyTests(unittest.TestCase):
    def test_container_creation_does_not_install_optional_tools(self):
        config = json.loads((ROOT / "devcontainer.json").read_text())
        on_create = config["onCreateCommand"]
        post_create = config["postCreateCommand"]
        self.assertNotIn("setup.sh", on_create)
        self.assertNotIn("apt-get", on_create)
        self.assertTrue(post_create.startswith("bash .devcontainer/setup.sh all ||"))

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
