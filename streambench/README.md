# Streambench

Browser-based workshop for testing IPTV, radio and other media streams.

## Current scope

- direct HTTP/HTTPS stream playback,
- HLS playback through a locally vendored `hls.js`,
- local M3U/M3U8 file and text import,
- playlist filtering and entry selection,
- Free-TV Lite country playlists,
- iptv-org country and category catalogs,
- Cloudflare Worker static asset delivery with security headers.

User-provided playlists are parsed locally in the browser. Public provider data
and selected playlists are fetched through fixed, allowlisted Worker endpoints.
Stream media is never proxied by Streambench.

Free-TV Lite keeps HTTPS direct-media entries, excludes marked GeoIP streams
and removes duplicates. Poland is selected by default.

This version has no persistence, EPG or general-purpose remote playlist
import.

## Development

```sh
npm install
npm run dev
```

## Validation

```sh
npm run check
```

## Deployment

```sh
npm run deploy
```
