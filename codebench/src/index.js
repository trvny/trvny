const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
};

class RemoveElement {
  element(element) { element.remove(); }
}
class InjectHead {
  element(element) {
    element.prepend('<link rel="stylesheet" href="/fonts.css">', { html: true });
  }
}
class InjectBody {
  element(element) {
    element.append('<script src="/hardening.js"></script>', { html: true });
  }
}

export default {
  async fetch(request, env) {
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);

    const response = new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
    const type = headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return response;

    return new HTMLRewriter()
      .on('link[href^="https://fonts.googleapis.com"]', new RemoveElement())
      .on('link[href^="https://fonts.gstatic.com"]', new RemoveElement())
      .on("head", new InjectHead())
      .on("body", new InjectBody())
      .transform(response);
  },
};
