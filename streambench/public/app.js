"use strict";

const ui = {
  form: document.querySelector("#streamForm"),
  url: document.querySelector("#streamUrl"),
  mode: document.querySelector("#mediaMode"),
  shell: document.querySelector(".media-shell"),
  video: document.querySelector("#videoPlayer"),
  audio: document.querySelector("#audioPlayer"),
  title: document.querySelector("#nowPlaying"),
  status: document.querySelector("#status"),
  hint: document.querySelector("#streamHint"),
  file: document.querySelector("#playlistFile"),
  text: document.querySelector("#playlistText"),
  parse: document.querySelector("#parsePlaylist"),
  search: document.querySelector("#playlistSearch"),
  entries: document.querySelector("#playlistEntries"),
  empty: document.querySelector("#playlistEmpty"),
  count: document.querySelector("#entryCount"),
};

let playlist = [];
let hls = null;
let activeButton = null;

function setStatus(label, state = "idle") {
  ui.status.textContent = label;
  ui.status.dataset.state = state;
}

function validStreamUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function inferMode(url, requested = "auto", radio = false) {
  if (requested !== "auto") return requested;
  if (radio || /\.(mp3|aac|m4a|ogg|opus|flac)(?:$|[?#])/i.test(url)) return "audio";
  return "video";
}

function stopPlayback() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  for (const media of [ui.video, ui.audio]) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
}

function playbackError(message) {
  setStatus("Błąd", "error");
  ui.hint.textContent = message;
}

function playStream(rawUrl, options = {}) {
  const parsed = validStreamUrl(rawUrl.trim());
  if (!parsed) {
    playbackError("Adres musi używać protokołu HTTP albo HTTPS.");
    return;
  }

  const url = parsed.href;
  const mode = inferMode(url, options.mode || ui.mode.value, options.radio);
  const media = mode === "audio" ? ui.audio : ui.video;
  const isHls = /\.m3u8(?:$|[?#])/i.test(url);

  stopPlayback();
  ui.shell.dataset.mode = mode;
  ui.url.value = url;
  ui.title.textContent = options.title || parsed.hostname;
  ui.hint.textContent = parsed.protocol === "http:" && location.protocol === "https:"
    ? "Przeglądarka może zablokować ten stream jako niezabezpieczoną treść HTTP."
    : "Łączenie bezpośrednio ze źródłem streamu, bez proxy Streambencha.";
  setStatus("Łączenie", "loading");

  if (isHls && window.Hls?.isSupported()) {
    hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    hls.attachMedia(media);
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      media.play().catch(() => setStatus("Naciśnij play"));
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      playbackError(`HLS: ${data.details || data.type || "nieznany błąd"}`);
      hls?.destroy();
      hls = null;
    });
    return;
  }

  if (isHls && !media.canPlayType("application/vnd.apple.mpegurl")) {
    playbackError("Ta przeglądarka nie obsługuje HLS ani Media Source Extensions.");
    return;
  }

  media.src = url;
  media.play().catch(() => setStatus("Naciśnij play"));
}

for (const media of [ui.video, ui.audio]) {
  media.addEventListener("playing", () => setStatus("Odtwarzanie", "playing"));
  media.addEventListener("waiting", () => setStatus("Buforowanie", "loading"));
  media.addEventListener("stalled", () => setStatus("Przestój", "loading"));
  media.addEventListener("ended", () => setStatus("Koniec"));
  media.addEventListener("error", () => {
    if (!hls) playbackError("Odtwarzacz nie może otworzyć tego źródła.");
  });
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  activeButton?.removeAttribute("aria-current");
  activeButton = null;
  playStream(ui.url.value);
});

function parseAttributes(line) {
  const attributes = {};
  for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function parseM3u(source) {
  const items = [];
  let pending = null;

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.lastIndexOf(",");
      const attributes = parseAttributes(line);
      pending = {
        title: (comma >= 0 ? line.slice(comma + 1) : attributes["tvg-name"] || "").trim(),
        group: attributes["group-title"] || "",
        radio: attributes.radio === "true" || attributes.type === "radio",
      };
      continue;
    }

    if (line.startsWith("#")) continue;
    const url = validStreamUrl(line);
    if (!url) {
      pending = null;
      continue;
    }

    items.push({
      url: url.href,
      title: pending?.title || url.hostname,
      group: pending?.group || "Bez grupy",
      radio: pending?.radio || false,
    });
    pending = null;
  }

  return items;
}

function entryButton(item) {
  const row = document.createElement("li");
  row.className = "playlist-entry";

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.search = `${item.title} ${item.group}`.toLocaleLowerCase("pl");

  const fallback = document.createElement("span");
  fallback.className = "channel-fallback";
  fallback.textContent = item.radio ? "♫" : "▶";

  const copy = document.createElement("span");
  copy.className = "channel-copy";
  const name = document.createElement("span");
  name.className = "channel-name";
  name.textContent = item.title;
  const meta = document.createElement("span");
  meta.className = "channel-meta";
  meta.textContent = item.group;
  copy.append(name, meta);
  button.append(fallback, copy);

  button.addEventListener("click", () => {
    activeButton?.removeAttribute("aria-current");
    activeButton = button;
    button.setAttribute("aria-current", "true");
    playStream(item.url, { title: item.title, radio: item.radio });
  });

  row.append(button);
  return row;
}

function renderPlaylist() {
  const query = ui.search.value.trim().toLocaleLowerCase("pl");
  const visible = query
    ? playlist.filter((item) => `${item.title} ${item.group}`.toLocaleLowerCase("pl").includes(query))
    : playlist;

  ui.entries.replaceChildren(...visible.map(entryButton));
  ui.empty.hidden = playlist.length > 0;
  ui.search.disabled = playlist.length === 0;
  ui.count.textContent = query ? `${visible.length}/${playlist.length}` : String(playlist.length);
}

function loadPlaylist(source, label) {
  playlist = parseM3u(source);
  ui.search.value = "";
  renderPlaylist();
  setStatus(playlist.length ? "Playlista gotowa" : "Pusta playlista", playlist.length ? "idle" : "error");
  ui.hint.textContent = playlist.length
    ? `${label}: wczytano ${playlist.length} pozycji lokalnie.`
    : `${label}: nie znaleziono poprawnych adresów HTTP lub HTTPS.`;
}

ui.file.addEventListener("change", async () => {
  const [file] = ui.file.files;
  if (!file) return;
  try {
    loadPlaylist(await file.text(), file.name);
  } catch {
    playbackError("Nie udało się odczytać pliku playlisty.");
  } finally {
    ui.file.value = "";
  }
});

ui.parse.addEventListener("click", () => loadPlaylist(ui.text.value, "Wklejony tekst"));
ui.search.addEventListener("input", renderPlaylist);
