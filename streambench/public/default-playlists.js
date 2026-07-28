import { dedupePlaylist, parseM3uWorkspace, serializeM3u } from "./playlist-format.js";

const DEFAULT_PLAYLISTS = [
  { path: "/playlists/iptv.m3u8", defaultRadio: false },
  { path: "/playlists/internet_radio.m3u8", defaultRadio: true },
];

async function readPlaylist(source) {
  const response = await fetch(source.path, {
    headers: { accept: "audio/x-mpegurl,text/plain" },
  });
  if (!response.ok) throw new Error(`${source.path} returned ${response.status}`);

  const text = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("#EXTM3U")) {
    throw new Error(`${source.path} is not an M3U playlist`);
  }

  return parseM3uWorkspace(text, {
    providerId: "bundled",
    providerLabel: "Wbudowane",
    defaultRadio: source.defaultRadio,
  });
}

async function loadDefaults() {
  const textarea = document.querySelector("#playlistText");
  const parseButton = document.querySelector("#parsePlaylist");
  const entryCount = document.querySelector("#entryCount");
  if (!textarea || !parseButton) return;

  const sources = await Promise.allSettled(DEFAULT_PLAYLISTS.map(readPlaylist));
  for (const [index, result] of sources.entries()) {
    if (result.status === "rejected") {
      console.warn(`Streambench skipped ${DEFAULT_PLAYLISTS[index].path}`, result.reason);
    }
  }

  const items = dedupePlaylist(sources
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value));

  if (!items.length) {
    console.warn("Streambench default playlists are unavailable");
    return;
  }

  window.streambenchBundledUrls = new Set(items.map((item) => item.url));
  if (Number(entryCount?.textContent || 0) > 0 || textarea.value.trim()) return;

  textarea.value = serializeM3u(items, { dedupe: false });
  parseButton.click();
  queueMicrotask(() => {
    textarea.value = "";
  });
}

loadDefaults().catch((error) => {
  console.warn("Streambench could not load its default playlists", error);
});
