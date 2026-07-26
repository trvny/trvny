# Streambench

Browser-based workshop for testing IPTV, radio and other media streams.

## Foundation scope

- direct HTTP/HTTPS stream playback,
- HLS playback through a locally vendored `hls.js`,
- local M3U/M3U8 file and text import,
- playlist filtering and entry selection,
- Cloudflare Worker static asset delivery with security headers.

Playlists are parsed in the browser. This version has no stream proxy, remote playlist import, persistence or provider integrations.

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
