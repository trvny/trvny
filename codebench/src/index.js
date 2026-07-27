import { favicon16Response } from "./favicon-16.js";
import { faviconResponse } from "./favicons.js";

const SITE_URL = "https://codebench.travny.workers.dev/";
const TITLE = "Code Bench — QR Code Generator, Barcode Maker & Scanner";
const DESCRIPTION =
  "Free browser-based QR code generator, barcode maker and scanner. Create styled QR codes, Code 128, EAN, Data Matrix, Aztec, PDF417 and more without uploading your data.";

const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https:",
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

const SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Code Bench",
  url: SITE_URL,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires a modern browser; camera scanning requires HTTPS.",
  description: DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "QR code generator",
    "QR and barcode scanner",
    "Barcode generator",
    "PNG and SVG export",
    "Client-side private processing",
  ],
}).replaceAll("<", "\\u003c");

class RemoveElement {
  element(element) { element.remove(); }
}
class SetText {
  constructor(value) { this.value = value; }
  element(element) { element.setInnerContent(this.value); }
}
class InjectHead {
  element(element) {
    element.append(
      `<meta name="description" content="${DESCRIPTION}">`
      + '<meta name="robots" content="index,follow,max-image-preview:large">'
      + `<link rel="canonical" href="${SITE_URL}">`
      + '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
      + '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">'
      + '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">'
      + '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">'
      + '<link rel="icon" href="/favicon.ico" sizes="any">'
      + '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
      + '<link rel="mask-icon" href="/favicon.svg" color="#DA2B1F">'
      + '<link rel="manifest" href="/site.webmanifest">'
      + '<meta property="og:type" content="website">'
      + '<meta property="og:locale" content="en_US">'
      + `<meta property="og:title" content="${TITLE}">`
      + `<meta property="og:description" content="${DESCRIPTION}">`
      + `<meta property="og:url" content="${SITE_URL}">`
      + '<meta property="og:image" content="https://codebench.travny.workers.dev/apple-touch-icon.png">'
      + '<meta name="twitter:card" content="summary">'
      + `<meta name="twitter:title" content="${TITLE}">`
      + `<meta name="twitter:description" content="${DESCRIPTION}">`
      + `<script type="application/ld+json">${SCHEMA}</script>`
      + '<link rel="stylesheet" href="/fonts.css">',
      { html: true },
    );
  }
}
class InjectBody {
  element(element) {
    element.append(
      '<script src="/hardening.js"></script><script src="/privacy-guard.js"></script><script src="/logo-compat.js"></script><script src="/svg-normalize.js"></script><script src="/module-shapes.js"></script><script src="/style-picker.js"></script><script src="/frame-presets.js"></script><script src="/svg-compat.js"></script><script src="/qr-raster.js"></script><script src="/qr-self-test.js"></script><script src="/scanner-compat.js"></script>',
      { html: true },
    );
  }
}

function textResponse(body, contentType, cacheControl = "public, max-age=3600") {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": cacheControl,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const generatedIcon = favicon16Response(url.pathname) || faviconResponse(url.pathname);
    if (generatedIcon) return generatedIcon;

    if (url.pathname === "/robots.txt") {
      return textResponse(
        `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`,
        "text/plain; charset=utf-8",
        "public, max-age=86400",
      );
    }

    if (url.pathname === "/sitemap.xml") {
      return textResponse(
        `<?xml version="1.0" encoding="UTF-8"?>\n`
          + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + `  <url><loc>${SITE_URL}</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n`
          + '</urlset>\n',
        "application/xml; charset=utf-8",
        "public, max-age=86400",
      );
    }

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
      .on("title", new SetText(TITLE))
      .on('link[href^="https://fonts.googleapis.com"]', new RemoveElement())
      .on('link[href^="https://fonts.gstatic.com"]', new RemoveElement())
      .on('link[rel="icon"]', new RemoveElement())
      .on('link[rel="shortcut icon"]', new RemoveElement())
      .on('link[rel="apple-touch-icon"]', new RemoveElement())
      .on('link[rel="mask-icon"]', new RemoveElement())
      .on('link[rel="manifest"]', new RemoveElement())
      .on("head", new InjectHead())
      .on("body", new InjectBody())
      .transform(response);
  },
};
