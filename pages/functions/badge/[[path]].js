// GET /badge/<slug>.svg               brand or ecosystem badge (cloudflare, claude, feedseek, kanarek, twojstar, ...)
// GET /badge/model/<model-id>.svg     icon picked from the model id (lobe-icons ModelIcon rules)
// GET /badge/o/<octicon>.svg          any Primer Octicon; ?label= text, ?color= palette name or hex
// GET /badge/feedseek/feeds.svg       live counters (COUNTERS in _shared/eco.js)
// GET /badge/status/<slug>.svg        live up/down (STATUS in _shared/eco.js)
// GET /badge/mark/<slug>.svg          bare square mark; ?size=16..512 (default 64)
// GET /badge/index.json               catalogue for /badges/
// Common: ?label= (max 40), ?value= adds a right segment (max 40), ?color= recolours.
// Icons: inline marks, pinned @primer/octicons and @lobehub/icons-static-svg on jsDelivr.
// Icon or probe failure still renders a badge, with a short cache.
import { BRANDS, cleanLabel, iconParts, iconUrl, modelStyle, placeIcon, renderBadge, renderMark } from "../_shared/badge.js";
import { COUNTERS, ECO, MARKS, OCTICONS_VERSION, OCTICON_NAME, PALETTE, STATUS, fetchText, octiconUrl, paletteColour, textFor } from "../_shared/eco.js";
import { LOBE_VERSION } from "../_shared/model-icons.js";

const MAX_LABEL = 40;
const MAX_ID = 120;
const DAY = 86400;
const SHORT = 300;

function svgResponse(svg, { status = 200, ttl = DAY } = {}) {
  return new Response(svg, {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}`,
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
}

function lookup(slug) {
  const key = slug.toLowerCase();
  if (Object.hasOwn(ECO, key)) return ECO[key];
  if (Object.hasOwn(BRANDS, key)) return { ...BRANDS[key], src: "lobe" };
  return null;
}

async function loadParts(fetchImpl, spec, id) {
  const ink = spec.ink ?? "#111111";
  if (spec.src === "inline") return { keep: "", body: MARKS[spec.icon], viewBox: "0 0 24 24" };
  const urls = spec.src === "oct" ? [octiconUrl(spec.icon, 24), octiconUrl(spec.icon, 16)] : [iconUrl(spec.icon, spec.color)];
  // One 4s budget for all attempts, body read included.
  const signal = AbortSignal.timeout(4000);
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { signal, cf: { cacheTtl: 2592000, cacheEverything: true } });
      if (!res.ok) continue;
      const parts = iconParts(await res.text(), id, ink, { fill: spec.src === "oct" });
      if (parts) return parts;
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}

function text(params, key) {
  return cleanLabel(params.get(key)).slice(0, MAX_LABEL) || null;
}

function recolour(spec, params) {
  const pair = paletteColour(params.get("color"));
  if (!pair) return spec;
  // Light colours as ink vanish on the light tile; fall back to the dark stop.
  const ink = textFor(pair[0]) === "#fff" ? pair[0] : pair[1];
  return { ...spec, c1: pair[0], c2: pair[1], ink: spec.src === "oct" ? ink : spec.ink, text: textFor(pair[0]) };
}

// Static part of a request -> { kind, spec } or null.
export function resolve(segments, params) {
  const parts = (Array.isArray(segments) ? segments : [segments]).filter(Boolean).map(String);
  if (!parts.length) return null;
  parts[parts.length - 1] = parts[parts.length - 1].replace(/\.svg$/i, "");
  const label = text(params, "label");
  const value = text(params, "value");
  const [head, ...rest] = parts;

  if (head === "model" && rest.length) {
    const model = rest.join("/").slice(0, MAX_ID);
    return { kind: "badge", spec: recolour({ ...modelStyle(model), src: "lobe", label: label ?? model.split("/").pop(), value }, params) };
  }
  if (head === "o" && rest.length === 1 && OCTICON_NAME.test(rest[0]) && rest[0].length <= 40) {
    const base = { src: "oct", icon: rest[0], c1: PALETTE.navy[0], c2: PALETTE.navy[1], ink: PALETTE.navy[0], label: label ?? rest[0], value };
    return { kind: "badge", spec: recolour(base, params) };
  }
  if (head === "mark" && rest.length === 1) {
    const spec = lookup(rest[0]);
    if (!spec) return null;
    const size = Math.min(512, Math.max(16, Number.parseInt(params.get("size"), 10) || 64));
    return { kind: "mark", spec, size };
  }
  if (head === "status" && rest.length === 1 && Object.hasOwn(STATUS, rest[0])) {
    const spec = lookup(rest[0]) ?? { label: rest[0], src: "oct", icon: "pulse", c1: "#3a3f47", c2: "#161b22" };
    return { kind: "status", check: STATUS[rest[0]], spec: recolour({ ...spec, label: label ?? spec.label }, params) };
  }
  if (rest.length === 1 && Object.hasOwn(COUNTERS, `${head}/${rest[0]}`)) {
    const counter = COUNTERS[`${head}/${rest[0]}`];
    const spec = lookup(counter.slug);
    return { kind: "counter", counter, spec: recolour({ ...spec, label: label ?? spec.label }, params) };
  }
  if (rest.length === 0) {
    const spec = lookup(head);
    if (spec) return { kind: "badge", spec: recolour({ ...spec, label: label ?? spec.label, value }, params) };
  }
  return null;
}

// Paths are relative to `canonical`; the /badges/ page previews them from its own origin.
export function catalogue() {
  const rows = [];
  for (const [slug, s] of Object.entries(ECO)) rows.push({ group: s.group, slug, label: s.label, path: `/badge/${slug}.svg` });
  for (const [slug, s] of Object.entries(BRANDS)) rows.push({ group: "AI & infra", slug, label: s.label, path: `/badge/${slug}.svg` });
  for (const key of Object.keys(COUNTERS)) rows.push({ group: "Live", slug: key, label: key, path: `/badge/${key}.svg` });
  for (const key of Object.keys(STATUS)) rows.push({ group: "Live", slug: `status/${key}`, label: `status ${key}`, path: `/badge/status/${key}.svg` });
  return { canonical: "https://travny.pages.dev", octicons: OCTICONS_VERSION, lobe: LOBE_VERSION, palette: Object.keys(PALETTE), badges: rows };
}

export async function onRequestGet(context, fetchImpl = fetch) {
  const url = new URL(context.request.url);
  const path = context.params?.path;
  const segs = Array.isArray(path) ? path : [path];
  if (segs.length === 1 && segs[0] === "index.json") {
    return new Response(JSON.stringify(catalogue()), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
    });
  }

  const hit = resolve(path, url.searchParams);
  if (!hit) {
    return svgResponse(renderBadge({ label: "unknown badge", c1: "#6e7681", c2: "#3d444d" }), { status: 404, ttl: SHORT });
  }

  const parts = hit.spec.icon ? await loadParts(fetchImpl, hit.spec, "b") : null;
  let ttl = hit.spec.icon && !parts ? SHORT : DAY;

  if (hit.kind === "mark") {
    if (!parts) return svgResponse(renderBadge({ label: "mark unavailable", c1: "#6e7681", c2: "#3d444d" }), { status: 503, ttl: SHORT });
    return svgResponse(renderMark(parts, hit.size, hit.spec.label), { ttl });
  }

  const spec = { ...hit.spec, icon: placeIcon(parts), id: "b" };
  if (hit.kind === "counter") {
    try {
      spec.value = await hit.counter.probe(fetchImpl);
      ttl = Math.min(ttl, 3600);
    } catch {
      spec.value = "n/a";
      spec.valueText = "#6e7781";
      ttl = SHORT;
    }
  } else if (hit.kind === "status") {
    let up = false;
    try {
      up = Boolean(hit.check.ok(await fetchText(fetchImpl, hit.check.url, { cacheTtl: 0 })));
    } catch {
      up = false;
    }
    Object.assign(spec, up ? { value: "up", valueBg: "#dafbe1", valueText: "#1a7f37" } : { value: "down", valueBg: "#ffebe9", valueText: "#cf222e" });
    ttl = 120;
  }
  return svgResponse(renderBadge(spec), { ttl });
}
