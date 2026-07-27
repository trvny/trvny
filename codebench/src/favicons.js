import { ICONS as androidIcons } from "./favicon-android.js";
import { ICONS as smallIcons } from "./favicon-small.js";

const ICONS = { ...smallIcons, ...androidIcons };

export function faviconResponse(pathname) {
  const icon = ICONS[pathname];
  if (!icon) return null;

  const binary = atob(icon.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Response(bytes, {
    headers: {
      "content-type": icon.type,
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
