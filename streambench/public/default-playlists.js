const DEFAULT_PLAYLISTS = [
  "/playlists/iptv.m3u8",
  "/playlists/internet_radio.m3u8",
];

async function readPlaylist(path) {
  const response = await fetch(path, {
    headers: { accept: "audio/x-mpegurl,text/plain" },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);

  const text = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("#EXTM3U")) throw new Error(`${path} is not an M3U playlist`);
  return text.split(/\r?\n/).slice(1).join("\n").trim();
}

async function loadDefaults() {
  const textarea = document.querySelector("#playlistText");
  const parseButton = document.querySelector("#parsePlaylist");
  const entryCount = document.querySelector("#entryCount");
  if (!textarea || !parseButton) return;

  const sources = await Promise.allSettled(DEFAULT_PLAYLISTS.map(readPlaylist));
  const bodies = sources
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);

  if (!bodies.length) {
    console.warn("Streambench default playlists are unavailable");
    return;
  }

  if (Number(entryCount?.textContent || 0) > 0 || textarea.value.trim()) return;

  textarea.value = ["#EXTM3U", ...bodies].join("\n");
  parseButton.click();
  queueMicrotask(() => {
    textarea.value = "";
  });
}

loadDefaults().catch((error) => {
  console.warn("Streambench could not load its default playlists", error);
});
