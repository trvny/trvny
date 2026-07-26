const STORAGE_KEY = "streambench.state.v1";
const MAX_RECENT = 20;
const MAX_ITEMS = 250;

function emptyState() {
  return {
    version: 1,
    favorites: {},
    hidden: {},
    edits: {},
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

function safeStateKey(value) {
  return String(value || "").replace(/[\u0000\r\n\t]/g, "");
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
  const storedKey = safeStateKey(item?.stateKey);
  if (storedKey) return storedKey;
  const provider = safeText(item?.providerId || "local", 60) || "local";
  const url = safeUrl(item?.url);
  const id = safeText(item?.id, 180);
  const identity = id && url ? `${id}|${url}` : url;
  return identity ? `${provider}:${identity}` : "";
}

export function itemSnapshot(item) {
  const url = safeUrl(item?.url);
  if (!url) return null;
  return {
    stateKey: safeStateKey(item.stateKey),
    id: safeText(item.id, 180),
    url,
    title: safeText(item.title, 180) || new URL(url).hostname,
    group: safeText(item.group, 120),
    album: safeText(item.album, 120),
    logo: safeUrl(item.logo),
    country: safeText(item.country, 40),
    language: safeText(item.language, 100),
    radio: Boolean(item.radio),
    hls: Boolean(item.hls),
    providerId: safeText(item.providerId || "local", 60) || "local",
    providerLabel: safeText(item.providerLabel || "Lokalna", 80) || "Lokalna",
    protocol: safeText(item.protocol, 20),
    playback: safeText(item.playback, 20),
    quality: safeText(item.quality, 20),
    external: Boolean(item.external),
  };
}

function normalizeItems(value, { edits = false } = {}) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [rawKey, item] of Object.entries(value).slice(0, MAX_ITEMS)) {
    const key = safeStateKey(rawKey);
    const snapshot = itemSnapshot({ ...item, stateKey: edits ? key : item?.stateKey });
    if (!key || !snapshot) continue;
    if (edits || itemKey(snapshot) === key) {
      snapshot.stateKey = key;
      result[key] = snapshot;
    }
  }
  return result;
}

export function normalizeState(value) {
  const state = emptyState();
  if (!value || typeof value !== "object") return state;
  state.favorites = normalizeItems(value.favorites);
  state.hidden = normalizeItems(value.hidden);
  state.edits = normalizeItems(value.edits, { edits: true });

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
    snapshot.stateKey = key;
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
      snapshot.stateKey = key;
      state.recent = [snapshot, ...state.recent.filter((entry) => itemKey(entry) !== key)].slice(0, MAX_RECENT);
      save();
    },
    clearRecent() {
      state.recent = [];
      save();
    },
    editFor(item) {
      return state.edits[itemKey(item)] || null;
    },
    applyEdit(item) {
      const key = itemKey(item);
      const edit = state.edits[key];
      return edit ? { ...item, ...edit, stateKey: key } : { ...item, stateKey: key };
    },
    setEdit(item, changes) {
      const key = itemKey(item);
      if (!key) return null;
      const snapshot = itemSnapshot({ ...item, ...changes, stateKey: key });
      if (!snapshot) return null;
      snapshot.stateKey = key;
      state.edits[key] = snapshot;
      save();
      return snapshot;
    },
    clearEdit(item) {
      const key = itemKey(item);
      if (!key || !state.edits[key]) return false;
      delete state.edits[key];
      save();
      return true;
    },
    items(view) {
      if (view === "favorites") return Object.values(state.favorites).map((item) => this.applyEdit(item));
      if (view === "recent") return state.recent.map((item) => this.applyEdit(item));
      if (view === "hidden") return Object.values(state.hidden).map((item) => this.applyEdit(item));
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
