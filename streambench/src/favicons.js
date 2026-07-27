import { ICON as android192Icon } from "./favicon-android-192.js";
import { ICON as android512Icon } from "./favicon-android-512.js";
import { ICON as appleIcon } from "./favicon-apple.js";
import { ICON as icoIcon } from "./favicon-ico-data.js";
import { ICONS as smallIcons } from "./favicon-small.js";

const ICONS = new Map([
  ...Object.entries(smallIcons),
  [appleIcon.path, appleIcon],
  [android192Icon.path, android192Icon],
  [android512Icon.path, android512Icon],
  [icoIcon.path, icoIcon],
]);

export function faviconResponse(pathname) {
  const icon = ICONS.get(pathname);
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
