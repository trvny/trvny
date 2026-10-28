const BRAND_ORIGIN = "https://trfny.com";
const HUB_ORIGIN = "https://travny.pages.dev";
const BRAND_PATHS = new Set(["/", "/index.html", "/robots.txt", "/sitemap.xml"]);

const tools = [
  ["Codebench", "QR codes, barcodes & scanning", "Turn links, contacts or Wi-Fi details into codes. Style, scan and export them in your browser.", "https://codebench.travny.workers.dev/"],
  ["Docbench", "Documents & PDFs", "Inspect, convert and maintain documents locally. Your source files stay on your device.", "https://docbench.travny.workers.dev/"],
  ["Streambench", "Playlists, radio & streams", "Open M3U playlists, browse public radio and IPTV catalogs, and inspect supported streams. Availability and browser support vary.", "https://streambench.travny.workers.dev/"],
  ["Feedseek", "A quieter way to follow the web", "Browse self-updating Atom feeds, import the OPML directory or read the public feed collection.", "https://trvny.github.io/feedseek/"],
  ["Local weather", "Chrzanów & Kościelec", "Compare weather sources, air quality and official warnings. Read the dashboard or subscribe to changes.", "https://weather.travny.workers.dev/"],
  ["TVPI", "TVP playlists & playback", "Find TVP channel endpoints and a browser player. Streams can expire or be unavailable in your region.", `${HUB_ORIGIN}/tv/`],
];

const title = "TRAVNY — tools for files, feeds and streams";
const description = "Independent browser tools for QR codes, documents, IPTV and radio, plus public feeds, local weather and technical writing. Built and maintained by TRAVNY.";
const schema = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${BRAND_ORIGIN}/#page`,
  url: `${BRAND_ORIGIN}/`,
  name: title,
  description,
  inLanguage: "en",
  creator: { "@id": `${HUB_ORIGIN}/#creator` },
  mainEntity: {
    "@type": "ItemList",
    itemListElement: tools.map(([name, , , url], index) => ({ "@type": "ListItem", position: index + 1, name, url })),
  },
});

function landing() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${description}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#04060a">
<link rel="canonical" href="${BRAND_ORIGIN}/">
<link rel="icon" href="${HUB_ORIGIN}/favicon.svg" type="image/svg+xml">
<link rel="describedby" href="${HUB_ORIGIN}/llms.txt">
<meta property="og:type" content="website"><meta property="og:locale" content="en_US">
<meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<meta property="og:url" content="${BRAND_ORIGIN}/"><meta property="og:image" content="${HUB_ORIGIN}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${schema}</script>
<style>
:root{color-scheme:dark;--bg:#04060a;--ink:#e8eef7;--muted:#a1afc2;--cyan:#69d5ff;--yellow:#fff27a;--green:#79dfa6;--line:#324054}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,sans-serif}a{color:var(--cyan);text-underline-offset:.25em}a:hover{color:var(--yellow)}a:focus-visible{outline:3px solid var(--yellow);outline-offset:5px}.skip{position:absolute;left:1rem;top:-5rem}.skip:focus{top:1rem;background:var(--bg);padding:.5rem}header,main,footer{max-width:1160px;margin:auto;padding-inline:32px}header{display:flex;justify-content:space-between;gap:24px;padding-block:24px;border-bottom:1px solid var(--line)}.brand{font:700 20px monospace;letter-spacing:.05em;color:var(--ink)}nav{display:flex;gap:24px;flex-wrap:wrap}h1{font:900 clamp(72px,17vw,188px)/1 monospace;letter-spacing:-.08em;margin:48px 0 20px;color:var(--yellow)}.signal{display:flex;gap:5px;margin-top:40px}.signal span{height:8px;flex:1;background:var(--cyan)}.signal span:nth-child(2){background:var(--green)}.signal span:nth-child(3){background:var(--yellow)}.signal span:nth-child(4){background:#ff8282}.intro{display:grid;grid-template-columns:1.3fr 1fr;gap:48px;align-items:start;margin-bottom:64px}.intro h2{font-size:clamp(28px,4vw,46px);line-height:1.15;margin:0;max-width:16ch;letter-spacing:-.035em}.intro p{margin:0;color:var(--muted);max-width:47ch}.tools{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;column-gap:48px}.tools li{border-top:1px solid var(--line);padding:28px 0 36px}.tools h3{font:700 27px/1.3 monospace;margin:0 0 6px}.tools h3 a{color:var(--cyan)}.tools .purpose{color:var(--green);margin:0 0 12px}.tools p{max-width:49ch;margin:0;color:var(--muted)}.more{padding:32px 0;border-top:1px solid var(--line);margin-top:12px}.more h2{font-size:25px;margin:0 0 12px}.more p{max-width:72ch;color:var(--muted);margin:0 0 12px}footer{padding-block:28px 48px;color:var(--muted);border-top:1px solid var(--line);font-size:15px}footer p{margin:0}footer a{color:var(--ink)}@media(max-width:650px){header,main,footer{padding-inline:20px}header{align-items:flex-start}nav{gap:10px 20px;justify-content:flex-end}h1{margin-top:36px}.intro{grid-template-columns:1fr;gap:24px;margin-bottom:44px}.intro h2{max-width:20ch}.tools{grid-template-columns:1fr}.tools li{padding-block:24px}.signal{margin-top:28px}}
</style></head><body>
<a class="skip" href="#main">Skip to tools</a>
<header><a class="brand" href="/" aria-label="TRAVNY home">TRAVNY</a><nav aria-label="Main"><a href="#tools">Explore tools</a><a href="${HUB_ORIGIN}/">Open the hub</a><a href="https://github.com/trvny">GitHub</a></nav></header>
<main id="main"><div class="signal" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
<h1>TRAVNY</h1><div class="intro"><h2>A browser can be a workshop.</h2><p>Make a code. Fix a document. Find something to listen to. A small collection of independent tools, public data and experiments, built for actual use.</p></div>
<section id="tools" aria-label="Tools"><ul class="tools">${tools.map(([name, purpose, text, url]) => `<li><h3><a href="${url}">${name}</a></h3><p class="purpose">${purpose}</p><p>${text}</p></li>`).join("")}</ul></section>
<section class="more"><h2>Behind the workbench</h2><p>TRAVNY is an independent developer publishing browser tools, automation and technical experiments. Source code and maintenance live on GitHub.</p><p><a href="${HUB_ORIGIN}/teksty/">Read the field notes and technical writing</a>, visit <a href="${HUB_ORIGIN}/lab/">the lab</a>, or brave the <a href="https://shitpost-reactor.travny.workers.dev/">automated Shitpost Reactor</a>. Its posts are machine-generated.</p></section></main>
<footer><p>Built and maintained by <a href="https://github.com/trvny">TRAVNY</a>. <a href="${HUB_ORIGIN}/">The hub</a> keeps the tools, feeds and project links together.</p></footer>
</body></html>`;
}

export function brandResponse(request) {
  const url = new URL(request.url);
  if (url.hostname !== "trfny.com" && url.hostname !== "www.trfny.com") return null;
  const isBrand = BRAND_PATHS.has(url.pathname);
  const headers = {
    "cache-control": "public, max-age=0, s-maxage=600",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-language": "en",
  };
  if (isBrand && request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed\n", { status: 405, headers: { ...headers, allow: "GET, HEAD", "x-robots-tag": "noindex" } });
  }
  const target = isBrand ? BRAND_ORIGIN : HUB_ORIGIN;
  if (url.origin !== target || url.pathname === "/index.html" || !isBrand) {
    const destination = new URL(target);
    destination.pathname = url.pathname === "/index.html" ? "/" : url.pathname;
    destination.search = url.search;
    return Response.redirect(destination.href, 301);
  }
  let body;
  if (url.pathname === "/robots.txt") {
    headers["content-type"] = "text/plain; charset=utf-8";
    body = `User-agent: *\nAllow: /\nSitemap: ${BRAND_ORIGIN}/sitemap.xml\n`;
  } else if (url.pathname === "/sitemap.xml") {
    headers["content-type"] = "application/xml; charset=utf-8";
    body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BRAND_ORIGIN}/</loc></url></urlset>\n`;
  } else {
    headers["content-type"] = "text/html; charset=utf-8";
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src https://travny.pages.dev; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
    body = landing();
  }
  return new Response(request.method === "HEAD" ? null : body, { headers });
}
