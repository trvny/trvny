import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../public/vendor/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/playlists/", import.meta.url), { recursive: true });
await Promise.all([
  copyFile(
    new URL("../node_modules/hls.js/dist/hls.min.js", import.meta.url),
    new URL("../public/vendor/hls.min.js", import.meta.url),
  ),
  copyFile(
    new URL("../../stuff/playlists/wklejony-tekst.m3u8", import.meta.url),
    new URL("../public/playlists/iptv.m3u8", import.meta.url),
  ),
]);

console.log("Vendored hls.js and bundled playlist");
