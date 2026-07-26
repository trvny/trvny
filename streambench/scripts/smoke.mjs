const rawBaseUrl = process.argv[2] || process.env.STREAMBENCH_URL;

if (!rawBaseUrl) {
  console.error("Usage: node scripts/smoke.mjs https://streambench.example.workers.dev");
  process.exit(2);
}

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== "https:") {
  throw new Error("Smoke target must use HTTPS");
}
baseUrl.pathname = "/";
baseUrl.search = "";
baseUrl.hash = "";

async function request(path, accept) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      accept,
      "user-agent": "streambench-smoke/1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkJson(path, validate) {
  const response = await request(path, "application/json");
  const body = await response.json();
  validate(body);
  console.log(`ok ${path}`);
}

await checkJson("/health", (body) => {
  assert(body?.status === "ok", "health status is not ok");
  assert(body?.service === "streambench", "unexpected health service");
});

await checkJson("/api/providers", (body) => {
  assert(Array.isArray(body.providers), "provider manifest is missing");
  for (const providerId of ["free-tv", "iptv-org"]) {
    const provider = body.providers.find((entry) => entry.id === providerId);
    assert(provider, `provider is missing: ${providerId}`);
    assert(provider.endpoints?.catalog?.startsWith("/api/catalog?provider="), `invalid catalog endpoint: ${providerId}`);
    assert(provider.endpoints?.playlist?.startsWith("/api/playlist?provider="), `invalid playlist endpoint: ${providerId}`);
  }
});

await checkJson("/api/catalog?provider=free-tv", (body) => {
  assert(body?.provider === "free-tv", "unexpected Free-TV provider id");
  assert(body.countries?.some((country) => country.code === "PL"), "Free-TV catalog has no Poland entry");
});

await checkJson("/api/catalog?provider=iptv-org", (body) => {
  assert(body?.provider === "iptv-org", "unexpected iptv-org provider id");
  assert(Array.isArray(body.countries) && body.countries.length > 0, "iptv-org countries are empty");
  assert(Array.isArray(body.categories) && body.categories.length > 0, "iptv-org categories are empty");
});

await checkJson("/api/providers/free-tv/catalog", (body) => {
  assert(body?.provider === "free-tv", "legacy provider route failed");
});

const playlistPath = "/api/playlist?provider=free-tv&type=country&id=PL";
const playlistResponse = await request(playlistPath, "audio/x-mpegurl,text/plain");
const playlist = await playlistResponse.text();
const liteCount = Number(playlistResponse.headers.get("x-streambench-lite-count"));
assert(playlist.trimStart().startsWith("#EXTM3U"), "Free-TV playlist is not M3U");
assert(playlistResponse.headers.get("x-streambench-source") === "free-tv", "unexpected playlist source header");
assert(Number.isInteger(liteCount) && liteCount > 0, "Free-TV Lite playlist is empty");
assert(playlist.includes("#EXTINF:"), "Free-TV Lite playlist has no entries");
console.log(`ok ${playlistPath}`);
console.log(`smoke passed ${baseUrl.origin}`);
