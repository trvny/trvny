# TVPI

> Stable TRAVNY-domain links to TVP IPTV channels. Streaming resolution stays in the existing TVPI Worker.

## Public endpoints

- [TV page](https://bartek.lol/tv/)
- [All channels in M3U](https://bartek.lol/tv/playlist.m3u)
- [Channel catalog JSON](https://bartek.lol/tv/api/channels)
- [Pushed-manifest freshness JSON](https://bartek.lol/tv/api/status)
- Individual HLS entry: `https://bartek.lol/tv/<slug>.m3u8`, e.g. [TVP 1](https://bartek.lol/tv/tvp1.m3u8)
- Individual M3U: `https://bartek.lol/tv/<slug>.m3u`
- [Direct TVPI Worker fallback](https://tvpi.travny.workers.dev/playlist.m3u)
- [Raw GitHub fallback](https://raw.githubusercontent.com/trvny/tvpi/main/streams/playlist.m3u)

## Semantics

The canonical channel catalog belongs to [TVPI](https://github.com/trvny/tvpi).
The hub rewrites the catalog's public URLs to `bartek.lol/tv` and generates
M3U playlists from that catalog. Channel `.m3u8` aliases redirect to the stable
TVPI Worker endpoint; HLS manifests and video segments do not pass through the hub.

`/tv/api/status` reports freshness of recently pushed R2 HLS manifests, **not**
verified playback or live stream availability. A missing/stale R2 manifest does not
prove a channel is offline because the Worker has other resolution fallbacks.
No API exposes TVP's short-lived signed upstream URLs.

## WebMCP

Browser-native agents with `document.modelContext.registerTool` can use
`get_travny_tv_channels` and `get_travny_tv_stream`. Both are read-only, use
the fixed hub API, and never navigate or initiate playback. Ordinary clients
can use the JSON and M3U endpoints without WebMCP support.

TVP geo-filtering and token expiry still apply. A Polish residential refresh runner
may be necessary for continuously fresh manifests.
