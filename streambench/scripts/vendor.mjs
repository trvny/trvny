import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../public/vendor/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/playlists/", import.meta.url), { recursive: true });
await Promise.all([
  copyFile(
    new URL("../node_modules/hls.js/dist/hls.min.js", import.meta.url),
    new URL("../public/vendor/hls.min.js", import.meta.url),
  ),
  // Both bundled playlists come from stuff/playlists/, the maintained source.
  // wklejony-tekst.m3u8 is the raw combined paste these two were split out of;
  // vendoring it put 100+ radio streams into the TV list and undid the cleanup.
  copyFile(
    new URL("../../stuff/playlists/iptv.m3u8", import.meta.url),
    new URL("../public/playlists/iptv.m3u8", import.meta.url),
  ),
  copyFile(
    new URL("../../stuff/playlists/internet_radio.m3u8", import.meta.url),
    new URL("../public/playlists/internet_radio.m3u8", import.meta.url),
  ),
]);

console.log("Vendored hls.js and bundled playlists");
