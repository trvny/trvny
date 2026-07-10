import { mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Copies the three runtime libraries out of node_modules into public/vendor/
// so the app is served fully self-contained (no CDN, works offline).
// Run automatically by Cloudflare Workers Builds via `npm run build`.

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const out = `${root}/public/vendor`;
mkdirSync(out, { recursive: true });

const files = [
  ["qr-code-styling/lib/qr-code-styling.js", "qr-code-styling.js"],
  ["bwip-js/dist/bwip-js-min.js", "bwip-js-min.js"],
  ["@zxing/library/umd/index.min.js", "zxing.min.js"],
];

for (const [from, to] of files) {
  copyFileSync(`${root}/node_modules/${from}`, `${out}/${to}`);
  console.log("vendored", to);
}
