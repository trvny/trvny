"""In-memory migration behavior checks; no real Google credentials."""
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("migrate", pathlib.Path(__file__).with_name("migrate.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Fake:
    def __init__(self, resources=None):
        self.resources = resources or {}
        self.writes = []

    def pages(self, base, path, **kw):
        yield from self.resources.get(path, [])

    def request(self, method, base, path, *, data=None, params=None):
        self.writes.append((base, path, data, params))
        if path == "/people:createContact":
            return {"resourceName": "people/new"}
        if path == "/users/@me/lists":
            return {"id": "dst-list"}
        return {"id": f"dst-task-{len(self.writes)}"}


class MigrationTests(unittest.TestCase):
    def worker(self, src, dst, state=None, dry=False, limit=200):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        return mod.Migrator(src, dst, state or {}, pathlib.Path(self.tmp.name) / "state.json", dry, limit)

    def test_contact_existing_and_new_and_resume(self):
        src = Fake({"/people/me/connections": [
            {"resourceName": "people/1", "names": [{"displayName": "Ada", "givenName": "Ada"}],
             "emailAddresses": [{"value": "ADA@EXAMPLE.COM"}]},
            {"resourceName": "people/2", "emailAddresses": [{"value": "new@example.com"}]}]})
        dst = Fake({"/people/me/connections": [{"emailAddresses": [{"value": "ada@example.com"}]}]})
        m = self.worker(src, dst)
        m.contacts()
        self.assertEqual(m.stats["contacts_existing"], 1)
        self.assertEqual(m.stats["contacts_added"], 1)
        self.assertEqual(len(dst.writes), 1)
        self.assertNotIn("metadata", dst.writes[0][2])
        m.contacts()
        self.assertEqual(len(dst.writes), 1)

    def test_dry_run_no_writes_or_checkpoint(self):
        src = Fake({"/people/me/connections": [{"resourceName": "people/1", "names": [{"givenName": "Ada"}]}]})
        dst = Fake({"/people/me/connections": []})
        m = self.worker(src, dst, dry=True)
        m.contacts()
        self.assertEqual(m.stats["pending"], 1)
        self.assertEqual(dst.writes, [])
        self.assertFalse(pathlib.Path(m.state_path).exists())

    def test_tasks_parent_before_child_and_replay(self):
        src = Fake({"/users/@me/lists": [{"id": "old", "title": "My Tasks"}],
                    "/lists/old/tasks": [{"id": "child", "parent": "parent", "title": "Child"},
                                          {"id": "parent", "title": "Parent", "status": "completed"}]})
        dst = Fake({"/users/@me/lists": [{"id": "default", "title": "My Tasks"}]})
        m = self.worker(src, dst)
        m.tasks()
        self.assertEqual(m.stats["tasks_added"], 2)
        self.assertEqual([v[2].get("title") for v in dst.writes[1:]], ["Parent", "Child"])
        self.assertEqual(dst.writes[2][3], {"parent": "dst-task-2"})
        m.tasks()
        self.assertEqual(len(dst.writes), 3)

    def test_budget_is_checkpointed(self):
        src = Fake({"/people/me/connections": [
            {"resourceName": "people/1", "names": [{"givenName": "One"}]},
            {"resourceName": "people/2", "names": [{"givenName": "Two"}]}]})
        dst = Fake({"/people/me/connections": []})
        m = self.worker(src, dst, limit=1)
        with self.assertRaises(mod.BudgetReached):
            m.contacts()
        self.assertEqual(len(m.state["contacts"]), 1)
        self.assertTrue(pathlib.Path(m.state_path).exists())


if __name__ == "__main__":
    unittest.main()
