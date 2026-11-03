const UPSTREAM = "https://api.radioparadise.com/api/now_playing?chan=0";
const MAX_BYTES = 32768;

async function readJson(response) {
  if (!response.body) throw new Error("empty response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function text(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function coverUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "img.radioparadise.com" &&
      !url.username && !url.password && !url.port && url.pathname.startsWith("/covers/") ? url.href : "";
  } catch { return ""; }
}

export async function onRequestGet() {
  try {
    const upstream = await fetch(UPSTREAM, {
      signal: AbortSignal.timeout(6000),
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 20, "400-599": 0 } },
    });
    if (!upstream.ok) throw new Error("upstream unavailable");
    const data = await readJson(upstream);
    const title = text(data.title);
    const artist = text(data.artist);
    if (!title || !artist) throw new Error("missing track");
    return Response.json({ title, artist, album: text(data.album), cover: coverUrl(data.cover_med || data.cover) }, {
      headers: { "cache-control": "public, max-age=0, s-maxage=20" },
    });
  } catch {
    return Response.json({ error: "metadata_unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
