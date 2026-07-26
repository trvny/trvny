const EXTERNAL_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "twitch.tv",
  "www.twitch.tv",
  "player.twitch.tv",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

const AUDIO_PATTERN = /\.(mp3|aac|m4a|ogg|opus|flac)(?:$|[?#])/i;
const VIDEO_FILE_PATTERN = /\.(mp4|m4v|webm|ogv|mov)(?:$|[?#])/i;
const HLS_PATTERN = /\.m3u8(?:$|[?#])/i;

export function inferQuality(title = "", declared = "") {
  const source = `${declared} ${title}`.toUpperCase();
  if (/\b(4K|UHD|2160P)\b/.test(source)) return "4K";
  if (/\b(FHD|1080P)\b/.test(source)) return "FHD";
  if (/\b(HD|720P)\b/.test(source)) return "HD";
  if (/\b(SD|576P|480P)\b/.test(source)) return "SD";
  return "";
}

export function classifyChannel(rawUrl, { title = "", radio = false, quality = "" } = {}) {
  const url = new URL(rawUrl);
  const external = EXTERNAL_HOSTS.has(url.hostname.toLowerCase());
  let playback = "Stream";

  if (external) playback = "Link";
  else if (HLS_PATTERN.test(url.href)) playback = "HLS";
  else if (radio || AUDIO_PATTERN.test(url.href)) playback = "Audio";
  else if (VIDEO_FILE_PATTERN.test(url.href)) playback = "Plik";

  return {
    external,
    playback,
    protocol: url.protocol === "https:" ? "HTTPS" : "HTTP",
    quality: inferQuality(title, quality),
  };
}
