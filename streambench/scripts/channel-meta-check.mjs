import { classifyChannel, inferQuality } from "../public/channel-meta.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(inferQuality("Kanał 4K") === "4K", "4K quality was not detected");
assert(inferQuality("Kanał", "1080p") === "FHD", "FHD quality was not detected");
assert(inferQuality("Kanał HD") === "HD", "HD quality was not detected");
assert(inferQuality("Kanał") === "", "unknown quality should stay empty");

const hls = classifyChannel("https://example.com/live.m3u8", { title: "News HD" });
assert(hls.playback === "HLS" && hls.protocol === "HTTPS" && hls.quality === "HD", "HLS metadata mismatch");

const radio = classifyChannel("http://example.com/live", { radio: true });
assert(radio.playback === "Audio" && radio.protocol === "HTTP", "radio metadata mismatch");

const file = classifyChannel("https://example.com/video.mp4");
assert(file.playback === "Plik", "video file metadata mismatch");

for (const url of [
  "https://www.youtube.com/watch?v=test",
  "https://player.vimeo.com/video/123",
]) {
  const external = classifyChannel(url);
  assert(external.external && external.playback === "Link", `external page metadata mismatch: ${url}`);
}

console.log("channel metadata checks passed");
