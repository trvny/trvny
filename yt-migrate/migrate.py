#!/usr/bin/env python3
"""YouTube account migration: copy subscriptions, own playlists and likes from SRC to DST.

Idempotent, quota-budgeted, resumable: every run diffs SRC vs DST and inserts
only what's missing, stopping before the daily quota is spent. Run daily.

Env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_SRC_REFRESH, YT_DST_REFRESH
     YT_BUDGET   units to spend this run (default 9000 of the 10k/day project quota)
     YT_STATE    path to JSON state (permanently failing items, skipped next runs)
     YT_DRY_RUN  "1" = list + report, no writes
Logs only counts and error reasons: Actions logs of a public repo are public.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/youtube/v3"
COST_LIST, COST_WRITE = 1, 50
# Write errors that will never succeed on retry -> remember and skip next runs.
PERMANENT = {"videoNotFound", "playlistItemsNotAccessible", "forbidden", "subscriptionForbidden",
             "subscriberNotFound", "publisherNotFound", "invalidResourceId", "videoNotFoundOrNotAccessible"}


class QuotaExhausted(Exception):
    pass


class Api:
    def __init__(self, refresh_token, budget):
        self.token = self._access_token(refresh_token)
        self.budget = budget

    @staticmethod
    def _access_token(refresh_token):
        body = urllib.parse.urlencode({
            "client_id": os.environ["YT_CLIENT_ID"],
            "client_secret": os.environ["YT_CLIENT_SECRET"],
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode()
        with urllib.request.urlopen("https://oauth2.googleapis.com/token", body, timeout=30) as r:
            return json.load(r)["access_token"]

    def call(self, method, path, cost, params=None, body=None):
        if self.budget.left < cost:
            raise QuotaExhausted
        url = f"{API}/{path}?{urllib.parse.urlencode(params or {})}"
        # Empty POST still needs a body (Content-Length: 0), else Google answers 411.
        data = json.dumps(body).encode() if body is not None else (b"" if method == "POST" else None)
        req = urllib.request.Request(url, data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        self.budget.left -= cost  # charged even on failure, like the real quota
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()  # videos.rate answers 204 with no body
                return (json.loads(raw) if raw else {}), None
        except urllib.error.HTTPError as e:
            try:
                reason = json.load(e)["error"]["errors"][0]["reason"]
            except Exception:
                reason = f"http{e.code}"
            if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
                raise QuotaExhausted
            return None, reason

    def pages(self, path, params):
        params = dict(params, maxResults=50)
        while True:
            res, err = self.call("GET", path, COST_LIST, params)
            if err:
                raise RuntimeError(f"list {path} failed: {err}")
            yield from res.get("items", [])
            if not res.get("nextPageToken"):
                return
            params["pageToken"] = res["nextPageToken"]


class Budget:
    def __init__(self, units):
        self.left = units


def migrate(src, dst, state, dry, stats):
    skip = state.setdefault("skip", [])

    def write(kind, key, path, params, body):
        if dry:
            stats[f"{kind}_pending"] = stats.get(f"{kind}_pending", 0) + 1
            return None
        res, err = dst.call("POST", path, COST_WRITE, params, body)
        if err:
            stats.setdefault("errors", {}).setdefault(err, 0)
            stats["errors"][err] += 1
            if err in PERMANENT and key not in skip:
                skip.append(key)
        else:
            stats[f"{kind}_added"] = stats.get(f"{kind}_added", 0) + 1
        return res

    # Subscriptions.
    have = {s["snippet"]["resourceId"]["channelId"] for s in dst.pages("subscriptions", {"part": "snippet", "mine": "true"})}
    want = [s["snippet"]["resourceId"]["channelId"] for s in src.pages("subscriptions", {"part": "snippet", "mine": "true"})]
    todo = [c for c in want if c not in have and f"sub:{c}" not in skip]
    stats["subs"] = f"{len(want) - len(todo)}/{len(want)}"
    for c in todo:
        write("subs", f"sub:{c}", "subscriptions", {"part": "snippet"},
              {"snippet": {"resourceId": {"kind": "youtube#channel", "channelId": c}}})

    # Own playlists, matched by title; items appended in source order.
    dst_pl = {p["snippet"]["title"]: p["id"] for p in dst.pages("playlists", {"part": "snippet", "mine": "true"})}
    for p in src.pages("playlists", {"part": "snippet,status", "mine": "true"}):
        title = p["snippet"]["title"]
        if title not in dst_pl:
            res = write("playlists", f"pl:{p['id']}", "playlists", {"part": "snippet,status"}, {
                "snippet": {"title": title, "description": p["snippet"].get("description", "")},
                "status": {"privacyStatus": p.get("status", {}).get("privacyStatus", "private")}})
            if not res:
                continue
            dst_pl[title] = res["id"]
        have = {i["contentDetails"]["videoId"] for i in dst.pages("playlistItems", {"part": "contentDetails", "playlistId": dst_pl[title]})}
        for i in src.pages("playlistItems", {"part": "contentDetails", "playlistId": p["id"]}):
            v = i["contentDetails"]["videoId"]
            if v in have or f"vid:{p['id']}:{v}" in skip:
                continue
            write("items", f"vid:{p['id']}:{v}", "playlistItems", {"part": "snippet"},
                  {"snippet": {"playlistId": dst_pl[title], "resourceId": {"kind": "youtube#video", "videoId": v}}})
            have.add(v)

    # Likes, oldest first so DST keeps the same order.
    liked = {v["id"] for v in dst.pages("videos", {"part": "id", "myRating": "like"})}
    src_likes = [v["id"] for v in src.pages("videos", {"part": "id", "myRating": "like"})]
    todo = [v for v in reversed(src_likes) if v not in liked and f"like:{v}" not in skip]
    stats["likes"] = f"{len(src_likes) - len(todo)}/{len(src_likes)}"
    for v in todo:
        write("likes", f"like:{v}", "videos/rate", {"id": v, "rating": "like"}, None)


def main():
    missing = [k for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_SRC_REFRESH", "YT_DST_REFRESH") if not os.environ.get(k)]
    if missing:
        print(f"::notice::yt-migrate skipped, secrets not set: {', '.join(missing)}")
        return 0
    state_path = os.environ.get("YT_STATE", "state.json")
    try:
        with open(state_path) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    budget = Budget(int(os.environ.get("YT_BUDGET", "9000")))
    dry = os.environ.get("YT_DRY_RUN") == "1"
    stats = {}
    done = False
    try:
        src = Api(os.environ["YT_SRC_REFRESH"], budget)
        dst = Api(os.environ["YT_DST_REFRESH"], budget)
        migrate(src, dst, state, dry, stats)
        done = True
    except QuotaExhausted:
        stats["stopped"] = "quota budget reached, continues next run"
    finally:
        with open(state_path, "w") as f:
            json.dump(state, f)
    stats.update(done=done, units_left=budget.left, skipped_permanent=len(state.get("skip", [])))
    print(json.dumps(stats, indent=2))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("## yt-migrate\n```json\n" + json.dumps(stats, indent=2) + "\n```\n")


if __name__ == "__main__":
    sys.exit(main())
