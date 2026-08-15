import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../public/vendor/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../node_modules/hls.js/dist/hls.min.js", import.meta.url),
  new URL("../public/vendor/hls.min.js", import.meta.url),
);

console.log("Vendored hls.js");
