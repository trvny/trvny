import { faviconResponse } from "./favicons.js";
import worker from "./index.js";
import { handleMediaApi } from "./media-api.js";
import { annotateProviderPlaylistResponse } from "./source-signing.js";

function isProviderPlaylist(pathname) {
  return pathname === "/api/playlist"
    || /^\/api\/providers\/[a-z0-9-]+\/playlist$/.test(pathname);
}

export default {
  async fetch(request, env, context) {
    const mediaApi = await handleMediaApi(request, env);
    if (mediaApi) return mediaApi;

    const url = new URL(request.url);
    const icon = faviconResponse(url.pathname);
    if (icon) {
      return request.method === "HEAD"
        ? new Response(null, { status: icon.status, headers: icon.headers })
        : icon;
    }

    const response = await worker.fetch(request, env, context);
    return isProviderPlaylist(url.pathname)
      ? annotateProviderPlaylistResponse(response, url, env.STREAMBENCH_RELAY_SECRET)
      : response;
  },
};
