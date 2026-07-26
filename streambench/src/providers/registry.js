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
];

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
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
