#!/usr/bin/env python3
"""YouTube account migration SRC -> DST: subscriptions, own playlists, likes, Watch later.

Idempotent, quota-budgeted, resumable: every run diffs SRC vs DST and writes
only what's missing, stopping before the daily quota is spent. Run daily.

Queue order: subscriptions -> playlists -> likes (API) -> YT Music library -> Watch later.
Every write batch is pre-checked with videos.list / channels.list (1 unit per 50 IDs),
so deleted/private targets get skipped instead of burning 50 units on a failed insert.

Env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_SRC_REFRESH, YT_DST_REFRESH
     YT_BUDGET   units to spend this run (default 9000 of the 10k/day project quota)
     YT_STATE    path to JSON state (skip/done keys carried between runs)
     YT_EXTRA    optional path to Takeout-derived JSON {"subs", "music", "watch_later"}
     YT_DRY_RUN  "1" = list + report, no writes
Logs only counts and error reasons: Actions logs of a public repo are public.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/youtube/v3"
COST_LIST, COST_WRITE = 1, 50
WL_TITLE = "Watch later (old account)"
# Write errors that will never succeed on retry -> remember and skip next runs.
PERMANENT = {"videoNotFound", "playlistItemsNotAccessible", "forbidden", "subscriptionForbidden",
             "subscriberNotFound", "publisherNotFound", "invalidResourceId", "videoNotFoundOrNotAccessible",
             "failedPrecondition", "videoRatingDisabled", "purchaseRequired"}
QUOTA = {"quotaExceeded", "dailyLimitExceeded"}
SLOWDOWN = {"rateLimitExceeded", "userRateLimitExceeded"}
TRANSIENT = {"backendError", "SERVICE_UNAVAILABLE", "internalError", "http500", "http502", "http503"}


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
        for attempt in range(4):
            if self.budget.left < cost:
                raise QuotaExhausted("budget")
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
            if reason in QUOTA:
                raise QuotaExhausted(reason)
            if (reason in SLOWDOWN or reason in TRANSIENT) and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            if reason in SLOWDOWN:
                raise QuotaExhausted(reason)
            return None, reason
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

    def existing(self, kind, ids):
        """Subset of ids (videos or channels) that still exist and are visible."""
        found = set()
        for i in range(0, len(ids), 50):
            res, err = self.call("GET", kind, COST_LIST, {"part": "id", "id": ",".join(ids[i:i + 50])})
            if err:  # can't tell -> don't drop anything
                return set(ids)
            found |= {x["id"] for x in res.get("items", [])}
        return found


class Budget:
    def __init__(self, units):
        self.left = units


def uniq(seq):
    seen = set()
    return [x for x in seq if not (x in seen or seen.add(x))]


def list_ids(api, playlist_id, stats, ordered=False):
    """Video IDs of a playlist; None (and counted) if this playlist can't be listed now."""
    try:
        ids = [i["contentDetails"]["videoId"] for i in api.pages("playlistItems", {"part": "contentDetails", "playlistId": playlist_id})]
    except RuntimeError as e:
        stats.setdefault("list_errors", []).append(str(e).rsplit(": ", 1)[-1])
        return None
    return ids if ordered else set(ids)


def migrate(src, dst, state, extra, dry, stats):
    skip = set(state.get("skip", []))
    done = set(state.get("done", []))

    def save():
        state["skip"], state["done"] = sorted(skip), sorted(done)

    def bump(key, n=1):
        stats[key] = stats.get(key, 0) + n

    def write(kind, key, path, params, body):
        if dry:
            bump(f"{kind}_pending")
            return None
        res, err = dst.call("POST", path, COST_WRITE, params, body)
        if err:
            stats.setdefault("errors", {}).setdefault(err, 0)
            stats["errors"][err] += 1
            if err in PERMANENT:
                skip.add(key)
        else:
            bump(f"{kind}_added")
        return res

    def run_batch(kind, todo, check, keyf, do):
        """Write todo in chunks of 50, dropping targets that no longer exist first."""
        for i in range(0, len(todo), 50):
            chunk = todo[i:i + 50]
            alive = chunk if dry else dst.existing(check, chunk)
            for x in chunk:
                if x not in alive:
                    skip.add(keyf(x))
                    bump(f"{kind}_gone")
                    continue
                do(x)
            save()

    try:
        # Subscriptions: API list + Takeout (API omits some).
        have = {s["snippet"]["resourceId"]["channelId"] for s in dst.pages("subscriptions", {"part": "snippet", "mine": "true"})}
        want = uniq([s["snippet"]["resourceId"]["channelId"] for s in src.pages("subscriptions", {"part": "snippet", "mine": "true"})]
                    + extra.get("subs", []))
        todo = [c for c in want if c not in have and f"sub:{c}" not in skip]
        stats["subs"] = f"{len(want) - len(todo)}/{len(want)}"
        run_batch("subs", todo, "channels", lambda c: f"sub:{c}",
                  lambda c: write("subs", f"sub:{c}", "subscriptions", {"part": "snippet"},
                                  {"snippet": {"resourceId": {"kind": "youtube#channel", "channelId": c}}}))

        # Own playlists, matched by title; items appended in source order.
        dst_pl = {p["snippet"]["title"]: p["id"] for p in dst.pages("playlists", {"part": "snippet", "mine": "true"})}

        def fill(title, src_items, status, key_prefix):
            if title not in dst_pl:
                res = write("playlists", f"pl:{key_prefix}", "playlists", {"part": "snippet,status"}, {
                    "snippet": {"title": title}, "status": {"privacyStatus": status}})
                if not res:
                    return
                dst_pl[title] = res["id"]
                have = set()  # fresh playlist: empty, and listing it right away can 404
            else:
                have = list_ids(dst, dst_pl[title], stats)
                if have is None:
                    return
            todo = [v for v in uniq(src_items) if v not in have and f"vid:{key_prefix}:{v}" not in skip]
            run_batch("items", todo, "videos", lambda v: f"vid:{key_prefix}:{v}",
                      lambda v: write("items", f"vid:{key_prefix}:{v}", "playlistItems", {"part": "snippet"},
                                      {"snippet": {"playlistId": dst_pl[title], "resourceId": {"kind": "youtube#video", "videoId": v}}}))

        for p in src.pages("playlists", {"part": "snippet,status", "mine": "true"}):
            items = list_ids(src, p["id"], stats, ordered=True)
            if items is not None:
                fill(p["snippet"]["title"], items, p.get("status", {}).get("privacyStatus", "private"), p["id"])

        # Likes: Liked videos playlist + myRating (both newest first), oldest first on DST.
        # DST listing caps around 1k, so successful likes are also remembered in state.
        liked = done | {v["id"] for v in dst.pages("videos", {"part": "id", "myRating": "like"})}
        dst_ll = list_ids(dst, "LL", stats)
        liked |= dst_ll or set()
        api_likes = uniq((list_ids(src, "LL", stats, ordered=True) or [])
                         + [v["id"] for v in src.pages("videos", {"part": "id", "myRating": "like"})])
        music = [v for v in extra.get("music", []) if v not in set(api_likes)]
        for kind, ids in (("likes", list(reversed(api_likes))), ("music", music)):
            todo = [v for v in ids if f"like:{v}" not in done and v not in liked and f"like:{v}" not in skip]
            stats[kind] = f"{len(ids) - len(todo)}/{len(ids)}"

            def like(v, kind=kind):
                if write(kind, f"like:{v}", "videos/rate", {"id": v, "rating": "like"}, None) is not None:
                    done.add(f"like:{v}")
            run_batch(kind, todo, "videos", lambda v: f"like:{v}", like)

        # Watch later: API can't read or write WL, so Takeout list -> private playlist.
        wl = extra.get("watch_later", [])
        if wl:
            fill(WL_TITLE, wl, "private", "WL")
            stats["watch_later"] = len(wl)
    finally:
        save()


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
    extra = {}
    if os.environ.get("YT_EXTRA") and os.path.exists(os.environ["YT_EXTRA"]):
        with open(os.environ["YT_EXTRA"]) as f:
            extra = json.load(f)
    budget = Budget(int(os.environ.get("YT_BUDGET", "9000")))
    dry = os.environ.get("YT_DRY_RUN") == "1"
    stats = {}
    done = False
    try:
        src = Api(os.environ["YT_SRC_REFRESH"], budget)
        dst = Api(os.environ["YT_DST_REFRESH"], budget)
        migrate(src, dst, state, extra, dry, stats)
        done = True
    except QuotaExhausted as e:
        stats["stopped"] = f"{e} - continues next run"
    finally:
        with open(state_path, "w") as f:
            json.dump(state, f)
    stats.update(done=done, units_left=budget.left, skipped_permanent=len(state.get("skip", [])),
                 liked_tracked=len(state.get("done", [])))
    print(json.dumps(stats, indent=2))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("## yt-migrate\n```json\n" + json.dumps(stats, indent=2) + "\n```\n")


if __name__ == "__main__":
    sys.exit(main())
