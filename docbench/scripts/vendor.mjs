import { cp, mkdir } from "node:fs/promises";

await mkdir("public/vendor", { recursive: true });
await cp(
  "node_modules/js-yaml/dist/browser/js-yaml.umd.min.js",
  "public/vendor/js-yaml.min.js",
);
