import { faviconResponse } from "./favicons.js";
import worker from "./index.js";
import { handleMediaApi } from "./media-api.js";

export default {
  async fetch(request, env, context) {
    const mediaApi = await handleMediaApi(request, env);
    if (mediaApi) return mediaApi;

    const icon = faviconResponse(new URL(request.url).pathname);
    if (icon) {
      return request.method === "HEAD"
        ? new Response(null, { status: icon.status, headers: icon.headers })
        : icon;
    }

    return worker.fetch(request, env, context);
  },
};
