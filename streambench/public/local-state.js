const STORAGE_KEY = "streambench.state.v1";
const MAX_RECENT = 20;
const MAX_ITEMS = 250;

function emptyState() {
  return {
    version: 1,
    favorites: {},
    hidden: {},
    recent: [],
    preferences: {
      provider: "",
      mediaMode: "auto",
    },
  };
}

function safeText(value, maxLength = 220) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function itemKey(item) {
  const provider = safeText(item?.providerId || "local", 60) || "local";
  const identity = safeText(item?.id, 180) || safeUrl(item?.url);
  return identity ? `${provider}:${identity}` : "";
}

export function itemSnapshot(item) {
  const url = safeUrl(item?.url);
  if (!url) return null;
  return {
    id: safeText(item.id, 180),
    url,
    title: safeText(item.title, 180) || new URL(url).hostname,
    group: safeText(item.group, 120),
    logo: safeUrl(item.logo),
    country: safeText(item.country, 40),
    language: safeText(item.language, 100),
    radio: Boolean(item.radio),
    providerId: safeText(item.providerId || "local", 60) || "local",
    providerLabel: safeText(item.providerLabel || "Lokalna", 80) || "Lokalna",
    protocol: safeText(item.protocol, 20),
    playback: safeText(item.playback, 20),
    quality: safeText(item.quality, 20),
    external: Boolean(item.external),
  };
}

function normalizeItems(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) {
    const snapshot = itemSnapshot(item);
    if (snapshot && itemKey(snapshot) === key) result[key] = snapshot;
  }
  return result;
}

export function normalizeState(value) {
  const state = emptyState();
  if (!value || typeof value !== "object") return state;
  state.favorites = normalizeItems(value.favorites);
  state.hidden = normalizeItems(value.hidden);

  if (Array.isArray(value.recent)) {
    const seen = new Set();
    for (const item of value.recent) {
      const snapshot = itemSnapshot(item);
      const key = snapshot ? itemKey(snapshot) : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      state.recent.push(snapshot);
      if (state.recent.length >= MAX_RECENT) break;
    }
  }

  const provider = safeText(value.preferences?.provider, 60);
  const mediaMode = ["auto", "video", "audio"].includes(value.preferences?.mediaMode)
    ? value.preferences.mediaMode
    : "auto";
  state.preferences = { provider, mediaMode };
  return state;
}

export function createLocalState(storage = globalThis.localStorage) {
  let state = emptyState();

  function load() {
    try {
      state = normalizeState(JSON.parse(storage?.getItem(STORAGE_KEY) || "null"));
    } catch {
      state = emptyState();
    }
    return state;
  }

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Browsing still works when storage is unavailable or full.
    }
  }

  function toggle(bucket, item) {
    const snapshot = itemSnapshot(item);
    const key = snapshot ? itemKey(snapshot) : "";
    if (!key) return false;
    if (state[bucket][key]) delete state[bucket][key];
    else state[bucket][key] = snapshot;
    save();
    return Boolean(state[bucket][key]);
  }

  load();
  return {
    get value() {
      return state;
    },
    reload: load,
    isFavorite(item) {
      return Boolean(state.favorites[itemKey(item)]);
    },
    isHidden(item) {
      return Boolean(state.hidden[itemKey(item)]);
    },
    toggleFavorite(item) {
      return toggle("favorites", item);
    },
    toggleHidden(item) {
      return toggle("hidden", item);
    },
    addRecent(item) {
      const snapshot = itemSnapshot(item);
      const key = snapshot ? itemKey(snapshot) : "";
      if (!key) return;
      state.recent = [snapshot, ...state.recent.filter((entry) => itemKey(entry) !== key)].slice(0, MAX_RECENT);
      save();
    },
    clearRecent() {
      state.recent = [];
      save();
    },
    items(view) {
      if (view === "favorites") return Object.values(state.favorites);
      if (view === "recent") return state.recent;
      if (view === "hidden") return Object.values(state.hidden);
      return [];
    },
    setPreference(name, value) {
      if (name === "provider") state.preferences.provider = safeText(value, 60);
      if (name === "mediaMode" && ["auto", "video", "audio"].includes(value)) {
        state.preferences.mediaMode = value;
      }
      save();
    },
  };
}
