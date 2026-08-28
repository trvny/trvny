/**
 * Rasterizes assets/status-mcp.svg into src/icon.ts, the constant the Worker
 * answers GET /icon.png from. Run `npm run build:icon` after editing the SVG.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// sharp is deliberately NOT a declared dependency. It is a native package this
// script needs perhaps once a year, and `npm ci` would then install it on every
// CI run and on every deploy. It is present anyway, as a transitive dependency
// of wrangler; when it is not, say so plainly instead of dying on a bare
// ERR_MODULE_NOT_FOUND.
let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error("sharp is not installed here. Run `npm i --no-save sharp@0.35.3` and try again.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, "../../../assets/status-mcp.svg");
const outPath = resolve(here, "../src/icon.ts");

// Palette mode keeps the base64 string small - the drawing is a handful of flat
// colours - but the palette has to stay wide enough to hold all of them. Pinned
// to `colours: 8` the quantizer dropped #FFFDF8 outright, and the circle that
// the SVG fills cream came out hollow: the served icon stopped matching its
// own source. Do not cap the colour count to shave a few kilobytes.
const png = await sharp(readFileSync(svgPath), { density: 384 })
  .resize(512, 512)
  .png({ palette: true, compressionLevel: 9, effort: 10 })
  .toBuffer();

// Fail loudly rather than commit an icon that has quietly lost a colour.
const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const centre = (262 * 512 + 424) * 4;
const cream = data[centre] === 0xff && data[centre + 1] === 0xfd && data[centre + 2] === 0xf8;
if (!cream) {
  const got = [...data.slice(centre, centre + 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
  throw new Error(`circle centre is #${got}, expected the #FFFDF8 fill from the SVG`);
}

const b64 = png.toString("base64");
const lines = b64
  .match(/.{1,96}/g)
  .map((line) => `  "${line}"`)
  .join(" +\n");

writeFileSync(
  outPath,
  `/**
 * GENERATED FILE - do not edit. Run \`npm run build:icon\` instead.
 *
 * \`assets/status-mcp.svg\` from the repo root, rasterized to a 512x512 indexed
 * PNG and base64-encoded. See scripts/build-icon.mjs and README.md.
 *
 * It is inlined rather than served from a static-assets binding because that
 * binding breaks this Worker's authentication: with \`assets\` configured, an
 * authenticated request stops being authorized (measured 2026-08-28, both the
 * bearer-header and token-in-path forms).
 */

export const ICON_PNG_BASE64 =
${lines};

export const ICON_BYTES = Uint8Array.from(atob(ICON_PNG_BASE64), (c) => c.charCodeAt(0));
`,
);

console.log(`icon.ts written: ${png.length} byte PNG, ${b64.length} base64 chars`);
