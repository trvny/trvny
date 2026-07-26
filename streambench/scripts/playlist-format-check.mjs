import { dedupePlaylist, parseM3uWorkspace, serializeM3u } from "../public/playlist-format.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = `#EXTM3U
#EXTINF:-1 tvg-id="tv.one" tvg-logo="https://example.com/logo.png" tvg-name="TV One" group-title="News",TV One
https://example.com/live.mpd
#EXTINF:-1 tvg-logo="https://example.com/radio.png",Radio One
#EXTALB:BBC
#EXTVLCOPT:http-user-agent=Streambench Test
https://example.com/radio.m3u8
https://example.com/raw.mp3
https://example.com/raw.mp3
`;

const items = parseM3uWorkspace(source, { providerId: "local", providerLabel: "Lokalna", defaultRadio: true });
assert(items.length === 4, "playlist entries were not parsed");
assert(items[0].id === "tv.one" && items[0].url.endsWith("live.mpd"), "IPTV metadata mismatch");
assert(items[1].album === "BBC" && items[1].group === "Bez grupy", "EXTALB was not preserved independently");
assert(items[2].radio && items[2].title === "example.com", "bare radio URL mismatch");
assert(dedupePlaylist(items).length === 3, "exact URL deduplication failed");

const exported = serializeM3u(items);
assert(exported.startsWith("#EXTM3U\n"), "export header is missing");
assert(exported.includes('tvg-id="tv.one"'), "tvg-id was not exported");
assert(exported.includes("#EXTALB:BBC"), "EXTALB was not exported");
assert(exported.includes("#EXTVLCOPT:http-user-agent=Streambench Test"), "item directive was not exported");
assert(exported.includes("https://example.com/live.mpd"), "MPD URL was not exported");
assert(exported.match(/https:\/\/example\.com\/raw\.mp3/g)?.length === 1, "export did not deduplicate exact URLs");

console.log("playlist format checks passed");
