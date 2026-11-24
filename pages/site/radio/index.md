# TRAVNY Radio

> Live, experimental Internet-only music station from the TRAVNY hub. Continuous shuffled MP3 stream with track metadata and album artwork.

Canonical information page: https://bartek.lol/radio/
Main hub player: https://bartek.lol/#radio
Standalone player: https://radio.bartek.lol/
Direct stream: https://radio.bartek.lol/radio.mp3

## Stream

- Format: MP3 (audio/mpeg), original source bitrate (CBR or VBR; varies by track).
- Playout: always-on shuffled library using Ezstream MP3 passthrough and Icecast distribution. No live transcoding or loudness processing.
- Service: Internet-only. No terrestrial broadcast frequency.
- The hub defaults to TRAVNY Radio; Radio Paradise, Trójka, Czwórka and BBC Radio 1 remain available in the station picker.
- Playback requires a user gesture in browsers that prevent autoplay.

## Now-playing APIs

Hub API (normalized; public, read-only):
https://bartek.lol/api/radio-station?station=travny

Successful responses use JSON fields `title`, `artist`, `album`, `cover`, and `kind` (`track`). The cover URL is an HTTPS image hosted by the radio server, or an empty string if unavailable. A temporary upstream failure returns HTTP 502 with `{"error":"metadata_unavailable"}`. Successful hub responses are edge-cacheable for five seconds; do not interpret them as sample-accurate synchronization.

Radio source API (richer state and queue):
https://radio.bartek.lol/api/now.json

A direct `https://radio.bartek.lol/*` request is redirected to the radio server's `*.ts.net` host. For audio players that dislike redirects, use https://travny-radio.taild44c6c.ts.net/radio.mp3 directly.

The canonical station information and structured data live at https://bartek.lol/radio/. The audio and source metadata live on the radio server. The hub adapter normalizes existing metadata, not a second now-playing database.

## WebMCP

Browser-native agents can call `get_travny_radio_now` on TRAVNY hub pages that support `document.modelContext.registerTool`. The tool uses the fixed same-origin hub API and returns the current track plus stream and player links. No arbitrary URL input, filesystem access, playback control or radio administration. Browsers without WebMCP can use the public GET API instead.

## Discovery

- Site LLM guide: https://bartek.lol/llms.txt
- Full machine-readable guide: https://bartek.lol/llms-full.txt
- Sitemap: https://bartek.lol/sitemap.xml
- Website source: https://github.com/trvny/trvny/tree/main/pages
