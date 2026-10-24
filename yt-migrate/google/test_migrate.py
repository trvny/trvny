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
        result = self.resources.get(path, {})
        if isinstance(result, dict):
            yield from result.get(kw.get("key", "items"), [])
        else:
            yield from result

    def request(self, method, base, path, *, data=None, params=None):
        self.writes.append((base, path, data, params))
        if path == "/people:createContact":
            return {"resourceName": "people/new"}
        if path == "/users/@me/lists":
            return {"id": "dst-list"}
        if path == "/calendars":
            return {"id": "dst-calendar"}
        return {"id": f"dst-task-{len(self.writes)}"}


class MigrationTests(unittest.TestCase):
    def worker(self, src, dst, state=None, dry=False, limit=200):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        return mod.Migrator(src, dst, state or {}, pathlib.Path(self.tmp.name) / "state.json", dry, limit)

    def test_contact_existing_and_new_and_resume(self):
        src = Fake({"/people/me/connections": {"connections": [
            {"resourceName": "people/1", "names": [{"displayName": "Ada", "givenName": "Ada"}],
             "emailAddresses": [{"value": "ADA@EXAMPLE.COM"}]},
            {"resourceName": "people/2", "emailAddresses": [{"value": "new@example.com"}]}]}})
        dst = Fake({"/people/me/connections": {"connections": [{"emailAddresses": [{"value": "ada@example.com"}]}]}})
        m = self.worker(src, dst)
        m.contacts()
        self.assertEqual(m.stats["contacts_existing"], 1)
        self.assertEqual(m.stats["contacts_added"], 1)
        self.assertEqual(len(dst.writes), 1)
        self.assertNotIn("metadata", dst.writes[0][2])
        m.contacts()
        self.assertEqual(len(dst.writes), 1)

    def test_dry_run_no_writes_or_checkpoint(self):
        src = Fake({"/people/me/connections": {"connections": [{"resourceName": "people/1", "names": [{"givenName": "Ada"}]}]}})
        dst = Fake({"/people/me/connections": {"connections": []}})
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

    def test_contact_matches_secondary_email_or_phone(self):
        src = Fake({"/people/me/connections": {"connections": [
            {"resourceName": "people/1", "emailAddresses": [
                {"value": "one@example.com"}, {"value": "shared@example.com"}]},
            {"resourceName": "people/2", "emailAddresses": [{"value": "other@example.com"}],
             "phoneNumbers": [{"value": "+48 123 456"}]}]}})
        dst = Fake({"/people/me/connections": {"connections": [
            {"emailAddresses": [{"value": "shared@example.com"}]},
            {"phoneNumbers": [{"value": "48123456"}]}]}})
        worker = self.worker(src, dst)
        worker.contacts()
        self.assertEqual(worker.stats["contacts_existing"], 2)
        self.assertEqual(dst.writes, [])

    def test_task_sibling_order_and_resume(self):
        src = Fake({"/users/@me/lists": [{"id": "old", "title": "Tasks"}],
                    "/lists/old/tasks": [
                        {"id": "c", "title": "Third", "position": "003"},
                        {"id": "a", "title": "First", "position": "001"},
                        {"id": "b", "title": "Second", "position": "002"}]})
        dst = Fake({"/users/@me/lists": []})
        worker = self.worker(src, dst, limit=2)
        with self.assertRaises(mod.BudgetReached):
            worker.tasks()
        self.assertEqual([x[2].get("title") for x in dst.writes[1:]], ["First"])
        worker.left = 5
        worker.tasks()
        self.assertEqual([x[2].get("title") for x in dst.writes[1:]],
                         ["First", "Second", "Third"])
        self.assertEqual(dst.writes[2][3], {"previous": "dst-task-2"})
        self.assertEqual(dst.writes[3][3], {"previous": "dst-task-3"})

    def test_budget_is_checkpointed(self):
        src = Fake({"/people/me/connections": {"connections": [
            {"resourceName": "people/1", "names": [{"givenName": "One"}]},
            {"resourceName": "people/2", "names": [{"givenName": "Two"}]}]}})
        dst = Fake({"/people/me/connections": {"connections": []}})
        m = self.worker(src, dst, limit=1)
        with self.assertRaises(mod.BudgetReached):
            m.contacts()
        self.assertEqual(len(m.state["contacts"]), 1)
        self.assertTrue(pathlib.Path(m.state_path).exists())


    def test_calendar_primary_dedup_preserves_private_copy_no_invites(self):
        a = {"id": "old", "iCalUID": "same@google", "summary": "Already there",
             "start": {"date": "2025-01-01"}, "end": {"date": "2025-01-02"}}
        b = {"id": "new", "iCalUID": "fresh@google", "summary": "Family",
             "attendees": [{"email": "friend@example.com"}],
             "start": {"date": "2025-02-01"}, "end": {"date": "2025-02-02"}}
        src = Fake({"/users/me/calendarList": [{"id": "src@example.com", "primary": True,
                                               "accessRole": "owner"}],
                    "/calendars/src%40example.com/events": [a, b]})
        dst = Fake({"/users/me/calendarList": [{"id": "dst@example.com", "primary": True}],
                    "/calendars/primary/events": [{"iCalUID": "same@google"}]})
        m = self.worker(src, dst)
        m.calendar()
        self.assertEqual(m.stats["calendar_existing"], 1)
        self.assertEqual(m.stats["calendar_events_added"], 1)
        self.assertEqual(len(dst.writes), 1)
        path, body = dst.writes[0][1:3]
        self.assertEqual(path, "/calendars/primary/events/import")
        self.assertNotIn("attendees", body)
        self.assertEqual(body["iCalUID"], "fresh@google")
        m.calendar()
        self.assertEqual(len(dst.writes), 1)

    def test_calendar_secondary_resume_budget_and_dry_run(self):
        src = Fake({"/users/me/calendarList": [
            {"id": "private-id", "summary": "Trips", "accessRole": "owner", "timeZone": "Europe/Warsaw"}],
            "/calendars/private-id/events": [
                {"id": "one", "iCalUID": "uid-1", "summary": "Trip",
                 "start": {"date": "2025-02-01"}, "end": {"date": "2025-02-02"}}]})
        dst = Fake({"/users/me/calendarList": []})
        dry = self.worker(src, dst, dry=True)
        dry.calendar()
        self.assertEqual(dry.stats["pending"], 2)
        self.assertEqual(dst.writes, [])
        self.assertFalse(pathlib.Path(dry.state_path).exists())
        worker = self.worker(src, dst, limit=1)
        with self.assertRaises(mod.BudgetReached):
            worker.calendar()
        self.assertEqual(worker.state["calendar"]["lists"]["private-id"], "dst-calendar")
        worker.left = 2
        worker.calendar()
        self.assertEqual(len(dst.writes), 2)
        self.assertEqual(dst.writes[0][1], "/calendars")
        self.assertEqual(dst.writes[0][2]["summary"], "Trips (migrated)")
        self.assertEqual(dst.writes[1][1], "/calendars/dst-calendar/events/import")

    def test_calendar_skips_modified_recurring_series_and_special(self):
        src = Fake({"/users/me/calendarList": [
            {"id": "src", "primary": True, "accessRole": "owner"},
            {"id": "others", "summary": "Shared", "accessRole": "reader"}],
            "/calendars/src/events": [
                {"id": "series", "iCalUID": "recurring@x", "recurrence": ["RRULE:FREQ=WEEKLY"],
                 "start": {"date": "2025-01-01"}, "end": {"date": "2025-01-02"}},
                {"id": "exception", "recurringEventId": "series", "iCalUID": "recurring@x",
                 "originalStartTime": {"date": "2025-01-08"}},
                {"id": "birthday", "eventType": "birthday", "iCalUID": "bday@x",
                 "start": {"date": "2025-01-03"}, "end": {"date": "2025-01-04"}},
                {"id": "valid", "iCalUID": "okay@x", "recurrence": ["RRULE:FREQ=WEEKLY"],
                 "start": {"date": "2025-01-01"}, "end": {"date": "2025-01-02"}}]})
        dst = Fake({"/users/me/calendarList": [], "/calendars/primary/events": []})
        worker = self.worker(src, dst)
        worker.calendar()
        self.assertEqual(worker.stats["calendar_skipped_exceptions"], 2)
        self.assertEqual(worker.stats["calendar_skipped_special"], 1)
        self.assertEqual(worker.stats["calendar_skipped_shared"], 1)
        self.assertEqual(worker.stats["calendar_events_added"], 1)
        self.assertEqual(dst.writes[0][2]["recurrence"], ["RRULE:FREQ=WEEKLY"])

    def test_calendar_existing_migrated_calendar_without_state_stops(self):
        src = Fake({"/users/me/calendarList": [
            {"id": "src2", "summary": "Travel", "accessRole": "owner"}]})
        dst = Fake({"/users/me/calendarList": [
            {"id": "existing2", "summary": "Travel (migrated)"}]})
        worker = self.worker(src, dst)
        with self.assertRaisesRegex(RuntimeError, "without checkpoint"):
            worker.calendar()
        self.assertEqual(dst.writes, [])


if __name__ == "__main__":
    unittest.main()
