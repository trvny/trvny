import { faviconResponse } from "./favicons.js";
import worker from "./index.js";

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
      + '<link rel="manifest" href="/site.webmanifest">',
      { html: true },
    );
  }
}

export default {
  async fetch(request, env, context) {
    const icon = faviconResponse(new URL(request.url).pathname);
    if (icon) return request.method === "HEAD" ? new Response(null, icon) : icon;

    const response = await worker.fetch(request, env, context);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return response;

    return new HTMLRewriter()
      .on('link[rel="icon"]', new RemoveElement())
      .on('link[rel="shortcut icon"]', new RemoveElement())
      .on('link[rel="apple-touch-icon"]', new RemoveElement())
      .on('link[rel="mask-icon"]', new RemoveElement())
      .on('link[rel="manifest"]', new RemoveElement())
      .on("head", new InjectFavicons())
      .transform(response);
  },
};
