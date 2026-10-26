// GET /badge/<brand>.svg          static brand badge (cloudflare, mcp, openrouter, ...)
// GET /badge/model/<model-id>.svg model badge; icon picked from the model id
//                                  (lobe-icons ModelIcon rules), e.g. /badge/model/deepseek/deepseek-chat.svg
// ?label=  overrides the text (max 40 chars).
// Icons come from a pinned @lobehub/icons-static-svg on jsDelivr; if that fails the
// badge still renders without an icon, with a short cache.
import { BRANDS, iconMarkup, iconUrl, modelStyle, renderBadge } from "../_shared/badge.js";

const MAX_LABEL = 40;
const MAX_ID = 120;

function svgResponse(svg, { status = 200, ttl = 86400 } = {}) {
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

async function loadIcon(fetchImpl, icon, color, id, ink) {
  try {
    const res = await fetchImpl(iconUrl(icon, color), { cf: { cacheTtl: 2592000, cacheEverything: true } });
    if (!res.ok) return null;
    return iconMarkup(await res.text(), id, ink);
  } catch {
    return null;
  }
}

export function resolve(segments, searchParams) {
  const parts = (Array.isArray(segments) ? segments : [segments]).filter(Boolean).map(String);
  if (!parts.length) return null;
  parts[parts.length - 1] = parts[parts.length - 1].replace(/\.svg$/i, "");
  const override = searchParams.get("label")?.trim().slice(0, MAX_LABEL) || null;

  if (parts[0] === "model" && parts.length > 1) {
    const model = parts.slice(1).join("/").slice(0, MAX_ID);
    const style = modelStyle(model);
    return { ...style, label: override ?? model.split("/").pop() };
  }
  if (parts.length === 1 && Object.hasOwn(BRANDS, parts[0].toLowerCase())) {
    const brand = BRANDS[parts[0].toLowerCase()];
    return { ...brand, label: override ?? brand.label };
  }
  return null;
}

export async function onRequestGet(context, fetchImpl = fetch) {
  const url = new URL(context.request.url);
  const spec = resolve(context.params?.path, url.searchParams);
  if (!spec) {
    return svgResponse(renderBadge({ label: "unknown badge", c1: "#6e7681", c2: "#3d444d" }), { status: 404, ttl: 300 });
  }
  const ink = spec.ink ?? "#111111";
  let icon = null;
  let ttl = 86400;
  if (spec.icon) {
    icon = await loadIcon(fetchImpl, spec.icon, spec.color, "b", ink);
    if (!icon) ttl = 300;
  }
  return svgResponse(renderBadge({ ...spec, icon, id: "b" }), { ttl });
}
