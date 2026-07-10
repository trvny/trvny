# Code Bench — deploy

Static, client-side QR & barcode studio. One HTML file in `public/`. No build step, no backend.

## Cloudflare Workers (recommended)

Assets-only Worker — no server code. Lands on `https://codebench.<your-subdomain>.workers.dev`, which gives you the https the camera scanner needs.

```bash
npx wrangler deploy
```

First run opens a browser to authorize your Cloudflare account. That's it.

- Local preview: `npx wrangler dev`
- Rename the deployment: edit `name` in `wrangler.jsonc`.
- Custom domain: Workers dashboard → your Worker → Settings → Domains & Routes → add a domain on a zone you control.

## Alternatives

**Cloudflare Pages** (drag-and-drop, no CLI): dashboard → Workers & Pages → Create → Pages → upload the `public/` folder.

**Anything else static** (Netlify, GitHub Pages, Vercel, an S3 bucket, your own nginx): just serve the `public/` folder over https. Fully self-contained — the three libraries (qr-code-styling, bwip-js, ZXing) are vendored in `public/vendor/`, so nothing loads from a CDN and it works offline / on locked-down networks.

## Note on the camera

Camera scanning requires a secure context (https or `localhost`). Any of the options above satisfy that. Opening the file directly from disk (`file://`) will not.
