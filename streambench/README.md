# Streambench

Browser-based workshop for testing IPTV, radio and other media streams.

## Current scope

- direct HTTP/HTTPS stream playback,
- HLS playback through a locally vendored `hls.js`,
- local M3U/M3U8 file and text import,
- playlist filtering and entry selection,
- channel labels for provider, protocol, playback type and quality,
- external video pages opened outside the media player,
- shared provider manifest and generic catalog routes,
- Free-TV Lite country playlists,
- iptv-org country and category catalogs,
- Cloudflare Worker static asset delivery with security headers.

User-provided playlists are parsed locally in the browser. Public provider data
and selected playlists are fetched through fixed, allowlisted Worker endpoints.
Stream media is never proxied by Streambench.

Free-TV Lite keeps HTTPS direct-media entries, excludes marked GeoIP streams
and removes duplicates. Poland is selected by default.

Known YouTube, Twitch and Vimeo pages are marked as external links instead of
being passed to the native media player. Unknown URLs remain neutral stream
candidates rather than being rejected based only on their file extension.

This version has no persistence, EPG or general-purpose remote playlist
import.

## Provider API

The browser loads provider metadata from `GET /api/providers` and uses:

- `GET /api/catalog?provider=<id>`,
- `GET /api/playlist?provider=<id>&type=<scope>&id=<value>`.

Existing `/api/providers/<id>/catalog` and `/api/providers/<id>/playlist`
routes remain available for compatibility. Provider IDs are resolved through a
fixed Worker registry; these endpoints are not a general remote fetcher.

## Development

```sh
npm install
npm run dev
```

## Validation

```sh
npm run check
```

## Deploy via Cloudflare Workers Builds

This project lives in the `trvny/trvny` monorepo under `streambench/`.

1. In Cloudflare Workers & Pages create a Worker by importing `trvny/trvny`.
2. Set the Worker name to `streambench` and root directory to `streambench`.
3. Use `npm run build` as the build command.
4. Use `npx wrangler deploy` as the deploy command.
5. Set the build watch path to `streambench/*`.

A local authenticated deployment uses:

```sh
npm run deploy
```

## Production smoke test

After deployment run:

```sh
npm run smoke -- https://streambench.example.workers.dev
```

The manual `Smoke streambench` GitHub workflow runs the same checks after
receiving the deployed HTTPS URL. It verifies health, the provider manifest,
generic and legacy catalog routes, and the Polish Free-TV Lite playlist.
