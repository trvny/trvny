// Only public HTTPS sources and dedicated local digest assets.
export function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      value.startsWith('https://') && !/[\s\\]/u.test(value);
  } catch {
    return false;
  }
}

export function isDigestMediaUrl(value) {
  return isHttpsUrl(value) ||
    /^\/przeglad\/assets\/[a-zA-Z0-9_-]+\.(?:svg|png|webp|jpe?g|gif|avif|mp4|webm)$/u.test(value);
}

export function chartMax(items) {
  return Math.max(1, ...items.map(({ value }) => value));
}

// Convert public source links into fixed official player URLs. Never accept
// arbitrary iframe URLs, redirect URLs, credentials or caller-supplied params.
export function digestEmbed(value) {
  if (!isHttpsUrl(value)) return null;
  const url = new URL(value);
  if (url.port) return null;
  const host = url.hostname;
  const path = url.pathname;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    const id = host === 'youtu.be' ? path.match(/^\/([\w-]{11})\/?$/)?.[1] :
      path === '/watch' ? url.searchParams.get('v') :
        path.match(/^\/(?:shorts|live)\/([\w-]{11})\/?$/)?.[1];
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return { provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/' + id, format: 'wide' };
    }
  }
  if (['vimeo.com', 'www.vimeo.com'].includes(host)) {
    const id = path.match(/^\/(\d{1,15})\/?$/)?.[1];
    if (id) return { provider: 'Vimeo', src: 'https://player.vimeo.com/video/' + id + '?autoplay=0&dnt=1', format: 'wide' };
  }
  if (['tiktok.com', 'www.tiktok.com'].includes(host)) {
    const id = path.match(/^\/@[\w.-]+\/(?:video|photo)\/(\d{10,25})\/?$/)?.[1];
    if (id) return { provider: 'TikTok', src: 'https://www.tiktok.com/player/v1/' + id + '?autoplay=0&description=1', format: 'portrait' };
  }
  if (host === 'open.spotify.com') {
    const match = path.match(/^\/(track|album|playlist|episode|show|artist)\/([a-zA-Z0-9]{22})\/?$/);
    if (match) return { provider: 'Spotify', src: 'https://open.spotify.com/embed/' + match[1] + '/' + match[2], format: 'audio' };
  }
  return null;
}
