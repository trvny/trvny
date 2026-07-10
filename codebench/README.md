# Code Bench — QR & Barcode Studio

Static, client-side app. One HTML file in `public/`, no backend. The three runtime
libraries (qr-code-styling, bwip-js, ZXing) are pulled from npm at build time into
`public/vendor/` — so the deployed site loads nothing from a CDN and works offline.

## Deploy via Cloudflare Workers Builds (CI, recommended)

This lives in the `trvny/trvny` monorepo under `codebench/`. One-time dashboard setup:

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Connect the GitHub account and pick **trvny/trvny**.
3. Configure the build:
   - **Worker name:** `codebench`
   - **Root directory:** `codebench`
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   (install runs automatically)
4. **Save and Deploy.**

Lands on `https://codebench.<your-subdomain>.workers.dev` (https — the camera scanner needs it).
Every push that touches `codebench/**` on `main` redeploys. To avoid rebuilds on unrelated
monorepo changes, set **Build watch paths** to `codebench/*` in the build settings.

## Deploy from your machine (no dashboard)

    cd codebench
    npm install
    npm run deploy      # runs the vendor build, then `wrangler deploy`

`npm run dev` for a local preview at localhost.

## Notes

- `public/vendor/` and `node_modules/` are gitignored; the build regenerates vendor/.
- Bump a library by editing its version in `package.json` — next build picks it up.
- Camera scanning needs a secure context (https or localhost); `file://` won't work.
