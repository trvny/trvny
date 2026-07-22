[![codebench](public/favicon.svg)](https://codebench.travny.workers.dev)
# Code Bench — QR & Barcode Studio

Client-side QR and barcode studio. The UI remains a single HTML document, while a
small Cloudflare Worker wraps static assets with security headers, local font
injection, and a focused hardening module. Scanned and generated values never
leave the browser.

Runtime libraries and fonts are copied from pinned npm packages into `public/`
during the build. Production performs no Google Fonts or other third-party CDN
requests.

## Deploy via Cloudflare Workers Builds

This lives in the `trvny/trvny` monorepo under `codebench/`.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Connect GitHub and select **trvny/trvny**.
3. Configure:
   - **Worker name:** `codebench`
   - **Root directory:** `codebench`
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Set **Build watch paths** to `codebench/*` and deploy.

The camera scanner needs HTTPS or localhost.

## Local

```sh
cd codebench
npm install
npm run dev
```

`npm run deploy` builds vendored assets and deploys them.

## Layout

- `public/index.html` — UI and original application logic;
- `public/hardening.js` — validation, safe exports, bounded image work, print fixes;
- `public/fonts.css` — self-hosted Space Grotesk and Space Mono declarations;
- `src/index.js` — static-asset Worker, HTML injection, and security headers;
- `scripts/vendor.mjs` — copies pinned libraries and WOFF2 files from `node_modules`.

Generated `public/vendor/`, `public/fonts/`, and `node_modules/` remain gitignored.
