export const PROVIDERS = [
  {
    id: "free-tv",
    label: "Free-TV Lite",
    link: "https://github.com/Free-TV/IPTV",
    status: "HTTPS · direct · bez Geo",
    filters: ["https", "direct", "no-geo"],
    capabilities: ["catalog", "playlist", "artwork"],
    scopes: [
      { id: "country", label: "Kraj", values: "countries", default: "PL" },
    ],
  },
  {
    id: "iptv-org",
    label: "iptv-org",
    link: "https://github.com/iptv-org/iptv",
    status: "Szeroki katalog publiczny",
    filters: [],
    capabilities: ["catalog", "playlist", "artwork"],
    scopes: [
      { id: "country", label: "Kraj", values: "countries", default: "PL" },
      { id: "category", label: "Kategoria", values: "categories", default: "news" },
    ],
  },
  {
    id: "radio-browser",
    label: "Radio Browser",
    link: "https://www.radio-browser.info/",
    status: "Publiczne radio · HTTPS · sprawdzone stacje",
    filters: ["https", "hidebroken"],
    capabilities: ["catalog", "playlist", "artwork", "radio"],
    scopes: [
      { id: "country", label: "Kraj", values: "countries", default: "PL" },
      { id: "tag", label: "Tag", values: "tags", default: "pop" },
    ],
  },
];

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

export function bindProviderHandlers(handlers) {
  for (const provider of PROVIDERS) {
    const handler = handlers[provider.id];
    if (typeof handler?.catalog !== "function" || typeof handler?.playlist !== "function") {
      throw new Error(`missing provider handlers: ${provider.id}`);
    }
  }

  for (const handlerId of Object.keys(handlers)) {
    if (!providerById(handlerId)) throw new Error(`unknown provider handlers: ${handlerId}`);
  }

  return new Map(PROVIDERS.map((provider) => [
    provider.id,
    { provider, ...handlers[provider.id] },
  ]));
}

export function providerManifest() {
  return PROVIDERS.map((provider) => ({
    ...provider,
    endpoints: {
      catalog: `/api/catalog?provider=${encodeURIComponent(provider.id)}`,
      playlist: `/api/playlist?provider=${encodeURIComponent(provider.id)}`,
    },
  }));
}
