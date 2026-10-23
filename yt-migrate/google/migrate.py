#!/usr/bin/env python3
"""Copy Google Contacts and Tasks between accounts. No source writes."""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PEOPLE = "https://people.googleapis.com/v1"
TASKS = "https://tasks.googleapis.com/tasks/v1"
CONTACT_FIELDS = ("names", "emailAddresses", "phoneNumbers", "addresses", "organizations",
                  "biographies", "birthdays", "nicknames", "urls", "events", "relations",
                  "userDefined", "imClients", "occupations", "interests")
TRANSIENT = {429, 500, 502, 503, 504}


class BudgetReached(Exception):
    pass


class ApiError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(f"Google API HTTP {code}")


class Client:
    def __init__(self, client_id, secret, refresh_token, dry=False):
        body = urllib.parse.urlencode({"client_id": client_id, "client_secret": secret,
                                       "refresh_token": refresh_token, "grant_type": "refresh_token"}).encode()
        request = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
        with urllib.request.urlopen(request, timeout=30) as reply:
            self.access_token = json.load(reply)["access_token"]
        self.dry = dry

    def request(self, method, base, path, *, params=None, data=None):
        url = base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        payload = json.dumps(data).encode() if data is not None else (b"" if method == "POST" else None)
        request = urllib.request.Request(url, data=payload, method=method,
            headers={"Authorization": "Bearer " + self.access_token, "Content-Type": "application/json"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=60) as reply:
                    raw = reply.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                if exc.code in TRANSIENT and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise ApiError(exc.code) from None
        raise RuntimeError("unreachable")

    def pages(self, base, path, *, params=None, key="items"):
        opts = dict(params or {})
        while True:
            page = self.request("GET", base, path, params=opts)
            yield from page.get(key, [])
            if not page.get("nextPageToken"):
                break
            opts["pageToken"] = page["nextPageToken"]


def sanitize(value):
    """Strip server-populated fields from writable People API data."""
    readonly = {"metadata", "formattedType", "formattedValue", "displayName", "displayNameLastFirst"}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items() if k not in readonly}
    return value


def contact_identifiers(person):
    """Every stable email / phone identifier; full-data fallback for nameless contacts."""
    identifiers = {
        "email:" + field["value"].strip().casefold()
        for field in person.get("emailAddresses", []) if field.get("value", "").strip()
    }
    identifiers.update(
        "phone:" + normalized
        for field in person.get("phoneNumbers", [])
        if (normalized := "".join(c for c in field.get("value", "") if c.isdigit()))
    )
    if not identifiers:
        identifiers.add("data:" + json.dumps(
            sanitize({k: person[k] for k in CONTACT_FIELDS if k in person}),
            sort_keys=True, ensure_ascii=False))
    return identifiers


class Migrator:
    def __init__(self, src, dst, state, state_path, dry, max_writes):
        self.src, self.dst, self.state = src, dst, state
        self.state_path, self.dry = state_path, dry
        self.left = max_writes
        self.stats = {"contacts_added": 0, "contacts_existing": 0, "task_lists_added": 0,
                      "tasks_added": 0, "tasks_skipped_assigned": 0, "pending": 0}

    def save(self):
        if self.dry:
            return
        path = pathlib.Path(self.state_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.state, sort_keys=True), encoding="utf-8")
        os.replace(temp, path)

    def write(self, base, path, data, *, params=None):
        if self.dry:
            self.stats["pending"] += 1
            return {}
        if self.left <= 0:
            raise BudgetReached()
        self.left -= 1
        return self.dst.request("POST", base, path, data=data, params=params)

    def contacts(self):
        state = self.state.setdefault("contacts", {})
        dest = list(self.dst.pages(PEOPLE, "/people/me/connections", params={
            "personFields": ",".join(CONTACT_FIELDS), "pageSize": 1000}, key="connections"))
        known = set().union(*(contact_identifiers(person) for person in dest))
        for person in self.src.pages(PEOPLE, "/people/me/connections", params={
            "personFields": ",".join(CONTACT_FIELDS), "pageSize": 1000}, key="connections"):
            source_id = person["resourceName"]
            fields = {k: sanitize(person[k]) for k in CONTACT_FIELDS if person.get(k)}
            if not fields or source_id in state:
                continue
            identifiers = contact_identifiers(person)
            if known.intersection(identifiers):
                self.stats["contacts_existing"] += 1
                if not self.dry:
                    state[source_id] = "existing"
                    self.save()
                continue
            result = self.write(PEOPLE, "/people:createContact", fields)
            self.stats["contacts_added"] += int(not self.dry)
            known.update(identifiers)
            if not self.dry:
                state[source_id] = result["resourceName"]
                self.save()
        self.state.setdefault("finished", {})["contacts"] = not self.dry
        self.save()

    def tasks(self):
        state = self.state.setdefault("tasks", {"lists": {}, "items": {}})
        source_lists = list(self.src.pages(TASKS, "/users/@me/lists", params={"maxResults": 100}))
        dest_lists = list(self.dst.pages(TASKS, "/users/@me/lists", params={"maxResults": 100}))
        dest_titles = {x["title"] for x in dest_lists}
        for source_list in source_lists:
            sid = source_list["id"]
            migrated_title = source_list.get("title", "Tasks") + " (migrated)"
            if sid in state["lists"]:
                did = state["lists"][sid]
            elif self.dry:
                did = None
                self.stats["pending"] += 1
            else:
                if migrated_title in dest_titles:
                    raise RuntimeError("existing migrated task list without checkpoint; stop to avoid duplicates")
                created = self.write(TASKS, "/users/@me/lists", {"title": migrated_title})
                did = created["id"]
                dest_titles.add(migrated_title)
                state["lists"][sid] = did
                self.stats["task_lists_added"] += 1
                self.save()
            source_tasks = list(self.src.pages(TASKS, f"/lists/{urllib.parse.quote(sid, safe='')}/tasks",
                params={"maxResults": 100, "showCompleted": "true", "showHidden": "true"}))
            mapped = state["items"].setdefault(sid, {})
            groups = {}
            for task in source_tasks:
                groups.setdefault(task.get("parent"), []).append(task)
            for siblings in groups.values():
                siblings.sort(key=lambda task: (task.get("position", ""), task["id"]))
            unseen = {task["id"] for task in source_tasks}

            def insert_children(parent=None):
                previous = None
                for task in groups.get(parent, []):
                    task_id = task["id"]
                    unseen.discard(task_id)
                    existing = mapped.get(task_id)
                    if task.get("assignmentInfo") or existing == "skipped":
                        if groups.get(task_id):
                            raise RuntimeError("assigned task has children; cannot reproduce")
                        if not existing:
                            self.stats["tasks_skipped_assigned"] += 1
                            if not self.dry:
                                mapped[task_id] = "skipped"
                                self.save()
                        continue
                    if not existing:
                        body = {k: task[k] for k in ("title", "notes", "status", "due", "completed") if k in task}
                        params = {}
                        if parent is not None and not self.dry:
                            params["parent"] = mapped[parent]
                        if previous and not self.dry:
                            params["previous"] = previous
                        if self.dry:
                            self.stats["pending"] += 1
                        else:
                            created = self.write(TASKS, f"/lists/{urllib.parse.quote(did, safe='')}/tasks",
                                                 body, params=params or None)
                            mapped[task_id] = created["id"]
                            self.stats["tasks_added"] += 1
                            self.save()
                    if not self.dry:
                        previous = mapped[task_id]
                    insert_children(task_id)

            insert_children()
            if unseen:
                raise RuntimeError("orphan task or cycle in source task hierarchy")
        self.state.setdefault("finished", {})["tasks"] = not self.dry
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=("all", "contacts", "tasks"), default="all")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    required = ("GM_CLIENT_ID", "GM_CLIENT_SECRET", "GM_SRC_REFRESH", "GM_DST_REFRESH", "GM_STATE")
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print("Configuration missing: " + ", ".join(missing), file=sys.stderr)
        return 2
    if os.environ["GM_SRC_REFRESH"] == os.environ["GM_DST_REFRESH"]:
        print("Source and destination tokens must differ", file=sys.stderr)
        return 2
    state_path = os.environ["GM_STATE"]
    try:
        state = json.loads(pathlib.Path(state_path).read_text()) if pathlib.Path(state_path).exists() else {}
        src = Client(os.environ["GM_CLIENT_ID"], os.environ["GM_CLIENT_SECRET"], os.environ["GM_SRC_REFRESH"])
        dst = Client(os.environ["GM_CLIENT_ID"], os.environ["GM_CLIENT_SECRET"], os.environ["GM_DST_REFRESH"])
        identity = "https://openidconnect.googleapis.com"
        source_subject = src.request("GET", identity, "/v1/userinfo").get("sub")
        dest_subject = dst.request("GET", identity, "/v1/userinfo").get("sub")
        if not source_subject or not dest_subject or source_subject == dest_subject:
            raise RuntimeError("unverified or identical source/destination account")
        worker = Migrator(src, dst, state, state_path, args.dry_run, int(os.environ.get("GM_MAX_WRITES", "200")))
        chosen = ("contacts", "tasks") if args.service == "all" else (args.service,)
        complete = True
        for service in chosen:
            if not state.get("finished", {}).get(service):
                getattr(worker, service)()
        if not args.dry_run:
            worker.state["complete"] = all(worker.state.get("finished", {}).get(x) for x in ("contacts", "tasks"))
            worker.save()
    except BudgetReached:
        complete = False
        worker.stats["write_limit_reached"] = True
    except (ApiError, RuntimeError, urllib.error.URLError, KeyError, ValueError) as exc:
        print("Migration stopped: " + (f"HTTP {exc.code}" if isinstance(exc, ApiError) else type(exc).__name__), file=sys.stderr)
        return 1
    worker.stats["complete"] = complete and not args.dry_run
    worker.stats["writes_left"] = worker.left
    report = json.dumps(worker.stats, sort_keys=True)
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write("## Google migration\n```json\n" + report + "\n```\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
