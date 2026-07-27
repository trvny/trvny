import { faviconResponse } from "./favicons.js";
import worker from "./index.js";
import { handleMediaApi } from "./media-api.js";

class RemoveElement {
  element(element) {
    element.remove();
  }
}

class InjectFavicons {
  element(element) {
    element.append(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
      + '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">'
      + '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">'
      + '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">'
      + '<link rel="icon" href="/favicon.ico" sizes="any">'
      + '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
      + '<link rel="mask-icon" href="/favicon.svg" color="#55e6a5">'
      + '<link rel="manifest" href="/site.webmanifest">'
      + '<link rel="stylesheet" href="/playlist-import.css">'
      + '<script type="module" src="/stream-bridge.js"></script>',
      { html: true },
    );
  }
}

class InjectEnhancements {
  element(element) {
    element.append(
      '<script type="module" src="/workspace-layout.js"></script>'
      + '<script type="module" src="/default-playlists.js"></script>'
      + '<script type="module" src="/source-workspace.js"></script>'
      + '<script type="module" src="/library-export.js"></script>'
      + '<script type="module" src="/radio-metadata.js"></script>',
      { html: true },
    );
  }
}

function withoutConditionalHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return new Request(request, { headers });
}

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

    const response = await worker.fetch(withoutConditionalHeaders(request), env, context);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return response;

    const headers = new Headers(response.headers);
    headers.delete("etag");
    headers.delete("last-modified");
    headers.set("cache-control", "no-cache");
    const html = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    return new HTMLRewriter()
      .on('link[rel="icon"]', new RemoveElement())
      .on('link[rel="shortcut icon"]', new RemoveElement())
      .on('link[rel="apple-touch-icon"]', new RemoveElement())
      .on('link[rel="mask-icon"]', new RemoveElement())
      .on('link[rel="manifest"]', new RemoveElement())
      .on("head", new InjectFavicons())
      .on("body", new InjectEnhancements())
      .transform(html);
  },
};
