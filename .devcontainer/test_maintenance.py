#!/usr/bin/env python3
"""Regression tests for scoped, non-destructive Devbox housekeeping."""

import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import maintenance  # noqa: E402


class HousekeepingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "home"
        self.home.mkdir()
        self.root = self.home / ".local/share/travny-devbox"
        self.root.mkdir(parents=True)
        self.now = time.time()

    def old_dir(self, parent: Path, name: str, days: int = 35) -> Path:
        parent.mkdir(parents=True, exist_ok=True)
        item = parent / name
        item.mkdir()
        (item / "marker.txt").write_text("keep or remove")
        past = self.now - days * maintenance.DAY
        os.utime(item, (past, past))
        return item

    def test_only_owned_expired_temps_are_auto_candidates(self):
        expired = self.old_dir(self.root, ".ubol-stage-expired", 3)
        smoke = self.old_dir(self.root / "chromium-profiles", "smoke-100", 3)
        self.old_dir(self.root / "chromium-profiles", "personal-login", 100)
        self.old_dir(self.root, ".ubol-stage-recent", 1)
        outside = self.old_dir(self.home / "workspaces", "precious", 100)
        linked = self.root / ".ubol-stage-symlink"
        linked.symlink_to(outside, target_is_directory=True)

        found = maintenance.managed_candidates(
            self.home, manual=False, now=self.now
        )
        self.assertEqual(set(found), {expired, smoke})
        for path in found:
            maintenance.prune(path)
        self.assertTrue(outside.is_dir())
        self.assertTrue(linked.is_symlink())
        self.assertTrue(
            (self.root / "chromium-profiles/personal-login").is_dir()
        )

    def test_manual_pruning_protects_current_and_two_recent_versions(self):
        ext = self.root / "extensions"
        version1 = self.old_dir(ext, "uBOLite-100", 4)
        version2 = self.old_dir(ext, "uBOLite-90", 6)
        version3 = self.old_dir(ext, "uBOLite-80", 38)
        version4 = self.old_dir(ext, "uBOLite-70", 70)
        (self.root / "ubol").symlink_to(version4, target_is_directory=True)
        found = maintenance.managed_candidates(
            self.home, manual=True, now=self.now
        )
        self.assertIn(version3, found)
        self.assertNotIn(version4, found)
        self.assertNotIn(version2, found)
        self.assertNotIn(version1, found)

    def test_auto_run_throttles_and_leaves_workspace_intact(self):
        expired = self.old_dir(self.root, ".ubol-stage-expired", 3)
        workspace = self.old_dir(self.home / "workspaces", "trvny", 70)
        with (mock.patch.object(maintenance.Path, "home", return_value=self.home),
              mock.patch.object(maintenance, "display_sizes"),
              mock.patch.object(maintenance.time, "time", return_value=self.now),
              mock.patch.object(sys, "argv", ["maintenance.py", "--auto"])):
            self.assertEqual(maintenance.main(), 0)
            self.assertFalse(expired.exists())
            self.assertTrue(workspace.exists())

            postponed = self.old_dir(self.root, ".ubol-stage-postponed", 3)
            self.assertEqual(maintenance.main(), 0)
            self.assertTrue(postponed.exists())


if __name__ == "__main__":
    unittest.main()
