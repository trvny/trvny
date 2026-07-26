const RADIO_BROWSER_LIMIT = 200;

function safeText(value, maxLength = 160) {
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

function m3uAttribute(value) {
  return safeText(value).replace(/["\\]/g, "");
}

function flagFromCode(code) {
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function hlsPlaybackUrl(rawUrl, hls) {
  if (!hls || /\.m3u8(?:$|[?#])/i.test(rawUrl)) return rawUrl;
  const url = new URL(rawUrl);
  const marker = "streambench-hls=.m3u8";
  url.hash = url.hash ? `${url.hash.slice(1)}&${marker}` : marker;
  return url.href;
}

function technicalLabel(station) {
  return [station.codec, station.bitrate ? `${station.bitrate} kb/s` : ""].filter(Boolean).join(" · ");
}

export function normalizeRadioBrowserCatalog(countryRows, tagRows, locale = "pl") {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const countries = countryRows
    .filter((row) => /^[A-Z]{2}$/.test(row?.name) && Number(row.stationcount) > 0)
    .map((row) => ({
      code: row.name,
      name: displayNames.of(row.name) || row.name,
      flag: flagFromCode(row.name),
      stationcount: Number(row.stationcount),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, locale));

  const tags = tagRows
    .map((row) => ({
      id: safeText(row?.name, 80),
      stationcount: Number(row?.stationcount),
    }))
    .filter((tag) => tag.id && tag.stationcount > 0)
    .map((tag) => ({
      ...tag,
      name: `${tag.id} (${tag.stationcount})`,
    }))
    .slice(0, 120);

  return { countries, tags };
}

export function radioBrowserSearchPath(type, id) {
  const params = new URLSearchParams({
    hidebroken: "true",
    is_https: "true",
    order: "votes",
    reverse: "true",
    limit: String(RADIO_BROWSER_LIMIT),
  });

  if (type === "country" && /^[A-Z]{2}$/.test(id)) {
    params.set("countrycode", id);
  } else if (type === "tag" && id.length > 0 && id.length <= 80) {
    params.set("tag", id);
    params.set("tagExact", "true");
  } else {
    return null;
  }
  return `/json/stations/search?${params}`;
}

export function radioBrowserStationsToM3u(rows) {
  const stations = [];
  const seen = new Set();

  for (const row of rows) {
    if (Number(row?.lastcheckok) !== 1) continue;
    const url = safeUrl(row.url_resolved || row.url);
    const name = safeText(row.name, 180);
    if (!url || !name) continue;

    const key = safeText(row.stationuuid, 80) || url;
    if (seen.has(key)) continue;
    seen.add(key);

    stations.push({
      id: key,
      name,
      url,
      logo: safeUrl(row.favicon),
      country: /^[A-Z]{2}$/.test(row.countrycode || "") ? row.countrycode : "",
      language: safeText(row.language, 100),
      tags: safeText(row.tags, 120),
      codec: safeText(row.codec, 30),
      bitrate: Number.isFinite(Number(row.bitrate)) ? Math.max(0, Number(row.bitrate)) : 0,
      hls: Number(row.hls) === 1,
    });
    if (stations.length >= RADIO_BROWSER_LIMIT) break;
  }

  const lines = ["#EXTM3U"];
  for (const station of stations) {
    const quality = technicalLabel(station);
    const attributes = [
      `tvg-id="${m3uAttribute(station.id)}"`,
      `tvg-name="${m3uAttribute(station.name)}"`,
      station.logo ? `tvg-logo="${m3uAttribute(station.logo)}"` : "",
      station.country ? `tvg-country="${station.country}"` : "",
      station.language ? `tvg-language="${m3uAttribute(station.language)}"` : "",
      station.tags ? `tvg-tags="${m3uAttribute(station.tags)}"` : "",
      `group-title="${m3uAttribute(station.tags ? `Radio · ${station.tags}` : "Radio")}"`,
      station.codec ? `tvg-codec="${m3uAttribute(station.codec)}"` : "",
      station.bitrate ? `tvg-bitrate="${station.bitrate}"` : "",
      quality ? `tvg-quality="${m3uAttribute(quality)}"` : "",
      station.hls ? `hls="true"` : "",
      `radio="true"`,
    ].filter(Boolean).join(" ");
    lines.push(`#EXTINF:-1 ${attributes},${station.name}`, hlsPlaybackUrl(station.url, station.hls));
  }

  return { body: `${lines.join("\n")}\n`, count: stations.length };
}
