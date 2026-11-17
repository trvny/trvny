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
    /^\/assets\/digest\/[a-zA-Z0-9_-]+\.(?:svg|png|webp|jpe?g|gif|avif|mp4|webm)$/u.test(value);
}

export function chartMax(items) {
  return Math.max(1, ...items.map(({ value }) => value));
}
