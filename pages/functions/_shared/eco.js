// Ecosystem badges: own marks (inline), Octicons (pinned CDN) and live values.
// Rows: slug -> { label, group, src: "inline"|"oct"|"lobe", icon, c1, c2, ink?, tile?, text?, color? }

export const OCTICONS_VERSION = "19.42.0";

// Original 24x24 marks. twojstar follows travnie/.github assets/gcp-burn (navy star, gold tip, shades, moustache).
export const MARKS = {
  twojstar:
    '<polygon points="12,1 15.29,8.07 23.03,9.02 17.33,14.33 18.82,21.98 12,18.2 5.18,21.98 6.67,14.33 0.97,9.02 8.71,8.07" fill="#14213d"/>' +
    '<polygon points="12,1 15.29,8.07 12,7.2" fill="#d4a83a"/>' +
    '<path d="M7.3 9.2H16.7V12.8C16.7 15.6 14.6 17 12 19.6 9.4 17 7.3 15.6 7.3 12.8Z" fill="#f8fafc"/>' +
    '<rect x="7.6" y="10" width="3.9" height="2.3" rx=".9" fill="#0b1324"/><rect x="12.5" y="10" width="3.9" height="2.3" rx=".9" fill="#0b1324"/><rect x="11.3" y="10.5" width="1.4" height=".7" fill="#0b1324"/>' +
    '<path d="M7.9 15C9.4 13.5 10.8 13.6 12 14.6 13.2 13.6 14.6 13.5 16.1 15 14.8 15.2 13.4 15.6 12 15.9 10.6 15.6 9.2 15.2 7.9 15Z" fill="#d4a83a"/>',
  kanarek:
    '<polygon points="4.6,13 .8,10.4 1.6,16.4" fill="#e0a800"/>' +
    '<ellipse cx="10.8" cy="14.2" rx="7.2" ry="5.6" fill="#f7c600"/>' +
    '<circle cx="16.4" cy="8.6" r="4.2" fill="#f7c600"/>' +
    '<path d="M6.6 12.8C8.6 11.2 12.2 11.6 13.6 14.2 11.4 16.4 8 16 6.6 12.8Z" fill="#e0a800"/>' +
    '<polygon points="20.2,7.6 23.6,8.9 20.3,10.3" fill="#f28c00"/>' +
    '<circle cx="17.6" cy="7.8" r=".95" fill="#1f2328"/>',
  autka:
    '<path d="M2 15V12.6C2 11.8 2.5 11.1 3.2 10.9L6 10 8.4 6.4C8.8 5.8 9.4 5.5 10.1 5.5H15.1C15.8 5.5 16.4 5.8 16.8 6.3L19.6 10 21.5 10.5C22.4 10.7 23 11.5 23 12.4V15C23 15.6 22.6 16 22 16H20.7A2.6 2.6 0 0 0 15.5 16H8.6A2.6 2.6 0 0 0 3.4 16H3C2.4 16 2 15.6 2 15Z" fill="#e63946"/>' +
    '<path d="M9.3 7.4 7.6 10H11.6V7.1H10.1C9.8 7.1 9.5 7.2 9.3 7.4ZM13 7.1V10H17.6L15.9 7.5C15.7 7.3 15.4 7.1 15.1 7.1Z" fill="#dbeafe"/>' +
    '<circle cx="6" cy="16.2" r="2.1" fill="#1f2328"/><circle cx="18.1" cy="16.2" r="2.1" fill="#1f2328"/>' +
    '<circle cx="6" cy="16.2" r=".8" fill="#adb5bd"/><circle cx="18.1" cy="16.2" r=".8" fill="#adb5bd"/>',
  tvpi:
    '<path d="M12 6.2 8 2.2M12 6.2 16.4 2.6" stroke="#1f2328" stroke-width="1.4" stroke-linecap="round"/>' +
    '<rect x="2" y="6" width="20" height="14" rx="3" fill="#1d4ed8"/>' +
    '<rect x="4.4" y="8.4" width="12" height="9.2" rx="1.6" fill="#e0f2fe"/>' +
    '<circle cx="19.2" cy="10.6" r="1" fill="#f8fafc"/><circle cx="19.2" cy="14" r="1" fill="#f8fafc"/>' +
    '<path d="M6 20 5 22M18 20 19 22" stroke="#1f2328" stroke-width="1.4" stroke-linecap="round"/>',
  // Halo + clock at 21:37. Deliberately no person.
  papiesz:
    '<ellipse cx="12" cy="3.8" rx="6.8" ry="2.1" fill="none" stroke="#e9b92c" stroke-width="1.8"/>' +
    '<circle cx="12" cy="14.5" r="8.4" fill="#fff8e1" stroke="#c9a227" stroke-width="1.6"/>' +
    '<path d="M12 14.5 7.73 13.07M12 14.5 7.65 19.33" stroke="#3b2f0b" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="12" cy="14.5" r="1.1" fill="#3b2f0b"/>',
};

// slug -> [label, group, src, icon, c1, c2, extra]
const ECO_ROWS = {
  twojstar: ["twojstar", "Brand", "inline", "twojstar", "#1c2c52", "#0b1324", { text: "#f1d27a" }],
  papiesz: ["papiesz", "Brand", "inline", "papiesz", "#f4d35e", "#c9a227", { text: "#2b2205", tile: "#fffdf3" }],
  feedseek: ["feedseek", "Apps", "oct", "rss", "#f26522", "#c4410c", { ink: "#e8590c" }],
  kanarek: ["Kanarek", "Apps", "inline", "kanarek", "#ffd23f", "#f2a900", { text: "#3a2a00" }],
  autka: ["Autka", "Apps", "inline", "autka", "#e63946", "#a4161a"],
  tvpi: ["tvpi", "Apps", "inline", "tvpi", "#2563eb", "#172554"],
  aistee: ["Aistee", "Apps", "oct", "ai-model", "#d718ce", "#7e0f78", { ink: "#b012a9" }],
  llmbench: ["llmbench", "Apps", "oct", "beaker", "#4f46e5", "#312e81", { ink: "#4338ca" }],
  wambridge: ["wambridge", "Apps", "oct", "unmute", "#0891b2", "#155e75", { ink: "#0e7490" }],
  weather: ["Weather Feed", "Apps", "oct", "sun", "#f59e0b", "#b45309", { ink: "#d97706" }],
  benches: ["Benches", "Workshop", "oct", "tools", "#0f766e", "#134e4a", { ink: "#0f766e" }],
  codebench: ["Codebench", "Workshop", "oct", "code-square", "#0f766e", "#134e4a", { ink: "#0f766e" }],
  streambench: ["Streambench", "Workshop", "oct", "broadcast", "#0e7490", "#134e4a", { ink: "#0e7490" }],
  docbench: ["Docbench", "Workshop", "oct", "file", "#15803d", "#134e4a", { ink: "#15803d" }],
  papagenerator: ["Papagenerator", "Workshop", "inline", "papiesz", "#f4d35e", "#c9a227", { text: "#2b2205", tile: "#fffdf3" }],
  spacemolt: ["SpaceMolt", "Workshop", "oct", "rocket", "#6d28d9", "#1e1b4b", { ink: "#5b21b6" }],
  claudiusz: ["Claudiusz", "Bots", "lobe", "claude", "#d97757", "#ae5131", { color: true }],
  gptomek: ["GPTomek", "Bots", "lobe", "openai", "#10a37f", "#0a7559", { ink: "#0a7559" }],
  gremlin: ["Gremlin", "Bots", "oct", "hubot", "#3f9142", "#1f4d22", { ink: "#2f6f32" }],
  "kanarek-companion": ["Kanarek Companion", "Bots", "inline", "kanarek", "#ffd23f", "#f2a900", { text: "#3a2a00" }],
  "shitpost-reactor": ["Shitpost Reactor", "Bots", "oct", "flame", "#ef4444", "#7f1d1d", { ink: "#dc2626" }],
  coderabbit: ["CodeRabbit", "Reviewers", "oct", "code-review", "#ff6b2b", "#c2410c", { ink: "#ea580c" }],
  "codex-review": ["Codex review", "Reviewers", "lobe", "codex", "#2e2e2e", "#0d0d0d", { color: true }],
  devin: ["Devin", "Reviewers", "lobe", "devin", "#1e3a8a", "#0f172a", { color: true }],
  greptile: ["Greptile", "Reviewers", "lobe", "greptile", "#16a34a", "#14532d", { color: true }],
  sourcery: ["Sourcery", "Reviewers", "oct", "zap", "#f59e0b", "#b45309", { ink: "#d97706" }],
  mergify: ["Mergify", "Reviewers", "oct", "git-merge-queue", "#1f6feb", "#0b3d91", { ink: "#1f6feb" }],
  dependabot: ["Dependabot", "Reviewers", "oct", "dependabot", "#0969da", "#0a3069", { ink: "#0969da" }],
};

export const ECO = Object.fromEntries(
  Object.entries(ECO_ROWS).map(([slug, [label, group, src, icon, c1, c2, extra = {}]]) => [
    slug,
    { label, group, src, icon, c1, c2, ...extra },
  ]),
);

// Generic octicon badges: named colours or 6-digit hex.
export const PALETTE = {
  navy: ["#1c2c52", "#0b1324"],
  gold: ["#e0b84c", "#a8801f"],
  blue: ["#2f81f7", "#0b3d91"],
  green: ["#2da44e", "#116329"],
  red: ["#e5484d", "#9b1c1f"],
  orange: ["#f2711c", "#bc4c00"],
  yellow: ["#f7c600", "#c79100"],
  purple: ["#8250df", "#4c2889"],
  pink: ["#d718ce", "#7e0f78"],
  teal: ["#14b8a6", "#0f5e57"],
  gray: ["#6e7781", "#32383f"],
  black: ["#3a3a3a", "#0d0d0d"],
};

export function paletteColour(name) {
  const key = String(name ?? "").toLowerCase();
  if (Object.hasOwn(PALETTE, key)) return PALETTE[key];
  const hex = /^#?([0-9a-f]{6})$/i.exec(key);
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  const dark = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.55).toString(16).padStart(2, "0"));
  return [`#${hex[1]}`, `#${dark.join("")}`];
}

// Some octicons ship 16px only (e.g. git-pull-request-agent): try 24, then 16.
// Dark text on light gradients (WCAG relative luminance of the start colour).
export function textFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return lum > 0.45 ? "#1f2328" : "#fff";
}

export function octiconUrl(name, size = 24) {
  return `https://cdn.jsdelivr.net/npm/@primer/octicons@${OCTICONS_VERSION}/build/svg/${name}-${size}.svg`;
}

export const OCTICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Live values. Each probe returns a short string or throws.
const FEEDSEEK = "https://trvny.github.io/feedseek/";
const TVPI = "https://tvpi.travny.workers.dev/playlist.m3u"; // documented combined playlist (status-mcp uses the same)

export const COUNTERS = {
  "feedseek/feeds": {
    slug: "feedseek",
    async probe(fetchImpl) {
      const html = await fetchText(fetchImpl, FEEDSEEK);
      const listed = html.match(/data-search="/g)?.length;
      const stated = /\/\s*(\d+)\s*feeds/.exec(html)?.[1];
      const n = listed ?? (stated == null ? null : Number(stated));
      if (n == null) throw new Error("no feed count");
      return `${n} feeds`;
    },
  },
  "tvpi/channels": {
    slug: "tvpi",
    async probe(fetchImpl) {
      const n = (await fetchText(fetchImpl, TVPI)).match(/^#EXTINF/gm)?.length;
      if (!n) throw new Error("empty playlist");
      return `${n} channels`;
    },
  },
};

// status/<slug>: up when the check passes.
export const STATUS = {
  kanarek: { url: "https://kanarek.travny.workers.dev/health", ok: (body) => JSON.parse(body).ok === true },
  tvpi: { url: TVPI, ok: (body) => body.includes("#EXTINF") },
  feedseek: { url: FEEDSEEK, ok: (body) => body.includes("data-search=") },
  docbench: { url: "https://docbench.travny.workers.dev/", ok: () => true },
  hub: { url: "https://travny.pages.dev/", ok: () => true },
};

// cacheTtl 0: status probes must see fresh state (badge itself caches 2 min).
export async function fetchText(fetchImpl, url, { cacheTtl = 300 } = {}) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": "travny-badges" },
    signal: AbortSignal.timeout(6000),
    cf: cacheTtl ? { cacheTtl, cacheEverything: true } : { cacheTtl: 0, cacheEverything: false },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
