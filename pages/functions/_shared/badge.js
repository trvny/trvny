// Brand badges: light icon tile + gradient label, 28px. Same look as the static
// set in travnie/.github assets/badges (build.py BADGES); keep brand rows in sync.
import { CHAR_WIDTHS, LOBE_VERSION, MODEL_ICONS } from "./model-icons.js";

const H = 28;
const TILE = 34;
const PAD = 12;
const NEUTRAL = { c1: "#3a3f47", c2: "#161b22" };

// slug -> [label, lobe icon, colour icon?, gradient start, gradient end, extra]
// extra: ink = mono icon colour, tile = tile bg, text = label colour
const BRAND_ROWS = {
  cloudflare: ["Cloudflare", "cloudflare", true, "#f6821f", "#c85a08"],
  "workers-ai": ["Workers AI", "workersai", true, "#f38020", "#a8420a"],
  mcp: ["MCP", "mcp", false, "#33302c", "#0b0b0b"],
  github: ["GitHub", "github", false, "#2d333b", "#0d1117", { ink: "#0d1117" }],
  copilot: ["Copilot", "githubcopilot", false, "#8957e5", "#5a32a3", { ink: "#6e40c9" }],
  openrouter: ["OpenRouter", "openrouter", false, "#6467f2", "#3b3cb8", { ink: "#4f50d6" }],
  aihubmix: ["AiHubMix", "aihubmix", true, "#2f8bff", "#0057c8"],
  groq: ["Groq", "groq", false, "#f55036", "#c2321c", { ink: "#f55036" }],
  huggingface: ["Hugging Face", "huggingface", true, "#ffd21e", "#ff9d00", { text: "#2a1a00" }],
  ollama: ["Ollama", "ollama", false, "#3a3a3a", "#111111"],
  claude: ["Claude", "claude", true, "#d97757", "#ae5131"],
  "claude-code": ["Claude Code", "claudecode", true, "#d97757", "#8f3f22"],
  anthropic: ["Anthropic", "anthropic", false, "#3d3a33", "#141413", { ink: "#141413", tile: "#f0eee6" }],
  gpt: ["GPT", "openai", false, "#10a37f", "#0a7559", { ink: "#0a7559" }],
  openai: ["OpenAI", "openai", false, "#2e2e2e", "#0d0d0d", { ink: "#0d0d0d" }],
  codex: ["Codex", "codex", true, "#2e2e2e", "#0d0d0d"],
  gemini: ["Gemini", "gemini", true, "#4285f4", "#8e63d2"],
  google: ["Google", "google", true, "#4285f4", "#1a5fd0"],
  deepseek: ["DeepSeek", "deepseek", true, "#4d6bfe", "#2b48d4"],
  qwen: ["Qwen", "qwen", true, "#615ced", "#3d36c4"],
  kimi: ["Kimi", "kimi", true, "#1783ff", "#0a55c9"],
  glm: ["GLM", "zai", false, "#3a3a3a", "#111111"],
  grok: ["Grok", "grok", false, "#3a3a3a", "#000000", { ink: "#000000" }],
  mistral: ["Mistral", "mistral", true, "#fa520f", "#c73e00"],
};

export const BRANDS = Object.fromEntries(
  Object.entries(BRAND_ROWS).map(([slug, [label, icon, color, c1, c2, extra = {}]]) => [
    slug,
    { label, icon, color, c1, c2, ...extra },
  ]),
);

// Model badges reuse brand colours by icon; anything else stays neutral.
const ICON_COLOURS = {};
for (const brand of Object.values(BRANDS)) ICON_COLOURS[brand.icon] ??= brand;
ICON_COLOURS.moonshot = BRANDS.kimi;
ICON_COLOURS.chatglm = BRANDS.glm;
ICON_COLOURS.glmv = BRANDS.glm;

const MATCHERS = MODEL_ICONS.map((entry) => ({
  ...entry,
  regexes: entry.keywords.map((keyword) => new RegExp(keyword, "i")),
}));

export function matchModel(model) {
  const id = String(model ?? "").toLowerCase();
  if (!id) return null;
  return MATCHERS.find((entry) => entry.regexes.some((re) => re.test(id))) ?? null;
}

export function modelStyle(model) {
  const hit = matchModel(model);
  if (!hit) return { ...NEUTRAL, icon: null };
  const brand = ICON_COLOURS[hit.icon];
  return {
    ...(brand ? { c1: brand.c1, c2: brand.c2, ink: brand.ink, tile: brand.tile, text: brand.text } : NEUTRAL),
    icon: hit.icon,
    color: Boolean(hit.color),
  };
}

export function iconUrl(icon, color) {
  return `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@${LOBE_VERSION}/icons/${icon}${color ? "-color" : ""}.svg`;
}

export function labelWidth(text) {
  let width = 0;
  for (const ch of text) width += CHAR_WIDTHS[ch] ?? 8;
  return width;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Lobe icon file -> nested <svg> body; ids namespaced per badge. Null when unusable.
export function iconMarkup(source, id, ink) {
  const m = /^\s*<svg([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(source ?? "");
  if (!m) return null;
  const [, attrs, raw] = m;
  if (/<script|<foreignObject|\son\w+\s*=|href\s*=\s*"(?!#)/i.test(raw)) return null;
  const body = raw
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/id="([^"]+)"/g, `id="${id}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${id}-$1"`)
    .replaceAll("></path>", "/>")
    .replaceAll("currentColor", ink);
  let keep = "";
  if (attrs.includes('fill="currentColor"')) keep += ` fill="${ink}"`;
  if (attrs.includes('fill-rule="evenodd"')) keep += ' fill-rule="evenodd"';
  return `<svg x="8" y="5" width="18" height="18" viewBox="0 0 24 24"${keep}>${body}</svg>`;
}

export function renderBadge({ label, c1, c2, tile = "#f8fafc", text = "#fff", icon = null, id = "b" }) {
  const safe = escapeXml(label);
  const tileW = icon ? TILE : 0;
  const labelW = Math.round(labelWidth(label) + 2 * PAD);
  const w = tileW + labelW;
  const tileRects = icon
    ? `<rect width="${TILE}" height="${H}" fill="${tile}"/>`
    : "";
  const divider = icon ? `<rect x="${TILE}" width="1" height="${H}" fill="${c2}" fill-opacity=".5"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${safe}">
  <title>${safe}</title>
  <defs>
    <linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="${id}-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".14"/><stop offset=".55" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}-clip"><rect width="${w}" height="${H}" rx="6"/></clipPath>
  </defs>
  <g clip-path="url(#${id}-clip)">
    ${tileRects}<rect x="${tileW}" width="${labelW}" height="${H}" fill="url(#${id}-g)"/><rect x="${tileW}" width="${labelW}" height="14" fill="url(#${id}-shine)"/>${divider}
  </g>
  <rect x=".5" y=".5" width="${w - 1}" height="${H - 1}" rx="5.5" fill="none" stroke="${c2}" stroke-opacity=".55"/>
  ${icon ?? ""}
  <text x="${tileW + labelW / 2}" y="18.5" text-anchor="middle" fill="${text}" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" font-weight="700" text-rendering="geometricPrecision">${safe}</text>
</svg>
`;
}
