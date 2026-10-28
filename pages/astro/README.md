# TRAVNY Astro lab

Incremental Astro 7 + MDX source for **/lab/** on the existing Cloudflare Pages project. The old hub and Quarto renders remain unchanged. Existing Pages Functions still inject shared navigation and now preserve English `lang` and `Content-Language` for Lab routes.

Run from `pages/astro`:

```sh
npm ci
npm run dev
npm run build
```

The Pages build copies only `astro/dist/lab/` into `site/lab/`. Do not point Astro's `outDir` at `../site`: that could wipe the legacy site. The build is deliberately additive.

## Roadmap

- **Lab:** MDX articles, interactive token experiments, widgets and experiments.
- **News:** start with the official HN API; later consume a canonical Feedseek adapter with caching and source attribution.
- **Radio:** start with a plain audio preview and Streambench link; later reuse Streambench's station/metadata contract.
- **Content:** migrate future posts gradually; keep old slugs, Atom IDs, SEO and sitemap stable.
- **Search:** add Pagefind or comparable static index once there is meaningful content.
- **Navigation:** only add a hub link when the section is ready, without replacing current design.

No new Cloudflare Pages project, Worker, feed pipeline or duplicated source of truth.
