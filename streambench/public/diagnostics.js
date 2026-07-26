import { classifyChannel } from "./channel-meta.js";

export function describeSource(rawUrl, options = {}) {
  const url = new URL(rawUrl);
  const channel = classifyChannel(url.href, options);
  const mixedContent = options.pageProtocol === "https:" && url.protocol === "http:";

  return {
    address: `${url.origin}${url.pathname}${url.search ? "?…" : ""}`,
    type: [channel.playback, channel.quality].filter(Boolean).join(" · "),
    security: mixedContent ? "Mixed content: przeglądarka może zablokować" : channel.protocol,
  };
}

export function describeHls(levels = [], { live = null, duration = null } = {}) {
  const resolutions = [...new Set(levels
    .map((level) => level.height ? `${level.height}p` : "")
    .filter(Boolean))];
  const codecs = [...new Set(levels
    .flatMap((level) => [level.videoCodec, level.audioCodec])
    .filter(Boolean))];
  const parts = [];

  if (live !== null) parts.push(live ? "live" : "VOD");
  if (levels.length) parts.push(`${levels.length} wariantów`);
  if (resolutions.length) parts.push(resolutions.join(", "));
  if (codecs.length) parts.push(codecs.join(", "));
  if (Number.isFinite(duration) && duration > 0 && !live) parts.push(`${Math.round(duration)} s`);
  return parts.join(" · ") || "Brak danych manifestu";
}

export function describeMedia(media) {
  if (!media) return "Brak danych odtwarzacza";
  const parts = [];
  if (media.videoWidth && media.videoHeight) parts.push(`${media.videoWidth}×${media.videoHeight}`);
  if (Number.isFinite(media.duration) && media.duration > 0) parts.push(`${Math.round(media.duration)} s`);
  parts.push(`ready ${media.readyState}`);
  parts.push(`network ${media.networkState}`);
  return parts.join(" · ");
}
