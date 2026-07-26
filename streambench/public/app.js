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
  providerScope: document.querySelector("#providerScope"),
  providerValue: document.querySelector("#providerValue"),
  providerLoad: document.querySelector("#loadProvider"),
  providerStatus: document.querySelector("#providerStatus"),
  file: document.querySelector("#playlistFile"),
  text: document.querySelector("#playlistText"),
  parse: document.querySelector("#parsePlaylist"),
  search: document.querySelector("#playlistSearch"),
  entries: document.querySelector("#playlistEntries"),
  empty: document.querySelector("#playlistEmpty"),
  count: document.querySelector("#entryCount"),
};

let playlist = [];
let providerCatalog = null;
let hls = null;
let activeButton = null;

function setStatus(label, state = "idle") {
  ui.status.textContent = label;
  ui.status.dataset.state = state;
}

function setProviderStatus(label, state = "idle") {
  ui.providerStatus.textContent = label;
  ui.providerStatus.dataset.state = state;
}

function validRemoteUrl(value) {
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
  const parsed = validRemoteUrl(rawUrl.trim());
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

function extinfTitle(line) {
  let quoted = false;
  for (let index = "#EXTINF:".length; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index - 1] !== "\\") quoted = !quoted;
    if (character === "," && !quoted) return line.slice(index + 1).trim();
  }
  return "";
}

function parseM3u(source) {
  const items = [];
  let pending = null;

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const attributes = parseAttributes(line);
      pending = {
        title: extinfTitle(line) || attributes["tvg-name"] || "",
        group: attributes["group-title"] || "",
        logo: validRemoteUrl(attributes["tvg-logo"] || "")?.href || "",
        country: attributes["tvg-country"] || "",
        language: attributes["tvg-language"] || "",
        radio: attributes.radio === "true" || attributes.type === "radio",
      };
      continue;
    }

    if (line.startsWith("#")) continue;
    const url = validRemoteUrl(line);
    if (!url) {
      pending = null;
      continue;
    }

    items.push({
      url: url.href,
      title: pending?.title || url.hostname,
      group: pending?.group || "Bez grupy",
      logo: pending?.logo || "",
      country: pending?.country || "",
      language: pending?.language || "",
      radio: pending?.radio || false,
    });
    pending = null;
  }

  return items;
}

function itemMeta(item) {
  return [item.group, item.country, item.language].filter(Boolean).join(" · ");
}

function channelArtwork(item) {
  const fallback = document.createElement("span");
  fallback.className = "channel-fallback";
  fallback.textContent = item.radio ? "♫" : "▶";

  if (!item.logo) return fallback;

  const logo = document.createElement("img");
  logo.className = "channel-logo";
  logo.src = item.logo;
  logo.alt = "";
  logo.loading = "lazy";
  logo.referrerPolicy = "no-referrer";
  logo.addEventListener("error", () => logo.replaceWith(fallback), { once: true });
  return logo;
}

function entryButton(item) {
  const row = document.createElement("li");
  row.className = "playlist-entry";

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.search = `${item.title} ${itemMeta(item)}`.toLocaleLowerCase("pl");

  const copy = document.createElement("span");
  copy.className = "channel-copy";
  const name = document.createElement("span");
  name.className = "channel-name";
  name.textContent = item.title;
  const meta = document.createElement("span");
  meta.className = "channel-meta";
  meta.textContent = itemMeta(item);
  copy.append(name, meta);
  button.append(channelArtwork(item), copy);

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
    ? playlist.filter((item) => `${item.title} ${itemMeta(item)}`.toLocaleLowerCase("pl").includes(query))
    : playlist;

  ui.entries.replaceChildren(...visible.map(entryButton));
  ui.empty.hidden = playlist.length > 0;
  ui.search.disabled = playlist.length === 0;
  ui.count.textContent = query ? `${visible.length}/${playlist.length}` : String(playlist.length);
}

function loadPlaylist(source, label) {
  playlist = parseM3u(source);
  activeButton?.removeAttribute("aria-current");
  activeButton = null;
  ui.search.value = "";
  renderPlaylist();
  setStatus(playlist.length ? "Playlista gotowa" : "Pusta playlista", playlist.length ? "idle" : "error");
  ui.hint.textContent = playlist.length
    ? `${label}: wczytano ${playlist.length} pozycji lokalnie.`
    : `${label}: nie znaleziono poprawnych adresów HTTP lub HTTPS.`;
  return playlist.length;
}

function renderProviderValues() {
  const countryMode = ui.providerScope.value === "country";
  const entries = countryMode ? providerCatalog?.countries : providerCatalog?.categories;
  const preferred = countryMode ? "PL" : "news";

  ui.providerValue.replaceChildren(...(entries || []).map((entry) => {
    const option = document.createElement("option");
    option.value = countryMode ? entry.code : entry.id;
    option.textContent = countryMode ? `${entry.flag || "🌐"} ${entry.name}` : entry.name;
    return option;
  }));

  if ([...ui.providerValue.options].some((option) => option.value === preferred)) {
    ui.providerValue.value = preferred;
  }
  ui.providerValue.disabled = !entries?.length;
  ui.providerLoad.disabled = !entries?.length;
}

async function loadProviderCatalog() {
  setProviderStatus("Pobieranie katalogu…", "loading");
  try {
    const response = await fetch("/api/providers/iptv-org/catalog", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    providerCatalog = await response.json();
    renderProviderValues();
    setProviderStatus("Katalog gotowy");
  } catch {
    ui.providerValue.disabled = true;
    ui.providerLoad.disabled = true;
    setProviderStatus("Nie udało się pobrać katalogu iptv-org.", "error");
  }
}

async function loadProviderPlaylist() {
  const type = ui.providerScope.value;
  const id = ui.providerValue.value;
  const selection = ui.providerValue.selectedOptions[0]?.textContent?.trim() || id;
  if (!id) return;

  const url = new URL("/api/providers/iptv-org/playlist", location.origin);
  url.searchParams.set("type", type);
  url.searchParams.set("id", id);

  ui.providerLoad.disabled = true;
  setProviderStatus(`Pobieranie: ${selection}…`, "loading");
  try {
    const response = await fetch(url, {
      headers: { accept: "audio/x-mpegurl,text/plain" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const count = loadPlaylist(await response.text(), `iptv-org · ${selection}`);
    setProviderStatus(count ? `Wczytano ${count} pozycji` : "Playlista jest pusta", count ? "idle" : "error");
  } catch {
    setProviderStatus("Nie udało się pobrać tej playlisty.", "error");
  } finally {
    ui.providerLoad.disabled = false;
  }
}

ui.providerScope.addEventListener("change", renderProviderValues);
ui.providerLoad.addEventListener("click", loadProviderPlaylist);
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

loadProviderCatalog();
