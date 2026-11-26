// Reactor UI. Shared hub tokens; no build-time dependency on Pages.
export const REACTOR_STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
html{background:var(--tr-bg,#04060a)}
body{margin:0;color:var(--tr-ink,#f4f0e6);font:16px/1.65 system-ui,sans-serif}
a{color:var(--tr-cyan,#46e0e0);text-underline-offset:3px}
a:focus-visible{outline:2px solid var(--tr-kanarek,#f5e94e);outline-offset:4px}
.wrap{width:min(1120px,100%);margin:auto;padding:clamp(16px,4vw,48px)}
.site-nav,.feeds,.crumb{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.2rem}
.site-nav{padding-bottom:1rem;border-bottom:1px solid var(--tr-line,#35414a)}
.site-nav a,.crumb a{text-decoration:none}
.site-nav .brand{font-weight:900;letter-spacing:.16em;color:var(--tr-ink,#f4f0e6);margin-right:auto}
.site-nav a:hover,.crumb a:hover{text-decoration:underline}
.site-nav [aria-current]{color:var(--tr-kanarek,#f5e94e)}
.masthead{padding:clamp(22px,4vw,44px) 0 18px}
.crumb,.meta,.eyebrow,.feeds{font:13px/1.5 var(--tr-font-label,monospace);color:var(--tr-muted,#aab1b5)}
.eyebrow{color:var(--tr-magenta,#e85ad0);letter-spacing:.12em;text-transform:uppercase}
h1{font-size:clamp(32px,7vw,72px);line-height:1.05;margin:.3em 0;color:var(--tr-kanarek,#f5e94e);letter-spacing:-.035em}
h1 a{color:inherit;text-decoration:none}
.rule{height:6px;margin:0 0 24px;background:linear-gradient(90deg,var(--tr-cyan,#46e0e0) 0 34%,var(--tr-kanarek,#f5e94e) 34% 67%,var(--tr-magenta,#e85ad0) 67%)}
.feeds{margin:1rem 0}
.listing{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.listing>h2,.listing>p,.listing>nav{grid-column:1/-1;margin:0}
article{min-width:0;background:var(--tr-panel,#10161d);border:1px solid var(--tr-line,#35414a);border-top:5px solid var(--tr-cyan,#46e0e0);padding:clamp(16px,3vw,28px);overflow-wrap:anywhere}
.listing article:nth-of-type(2n){border-top-color:var(--tr-magenta,#e85ad0)}
article h2{margin:0 0 .9rem;font-size:clamp(19px,2.6vw,26px);line-height:1.25;color:var(--tr-cyan,#46e0e0)}
article h2 a{text-decoration:none}
article h2 a:hover{text-decoration:underline}
article p{margin:.7rem 0}
article .entry-body{font-size:clamp(18px,2.5vw,23px);line-height:1.65}
article .meta{padding-top:1rem;border-top:1px solid var(--tr-line,#35414a);margin:1.2rem 0 0}
.reading{max-width:800px;margin:auto}
.reading article{padding:clamp(20px,5vw,42px)}
.reading article h2{font-size:clamp(24px,4vw,36px)}
figure{margin:0}
.meme{display:block;max-width:100%;height:auto;margin:1rem auto;border-radius:4px}
footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--tr-line,#35414a);color:var(--tr-muted,#aab1b5)}
@media(max-width:700px){.listing{grid-template-columns:minmax(0,1fr)}.site-nav{gap:.6rem 1rem}.site-nav .brand{width:100%}}
`;

export function reactorShell(body, pathname) {
  const post = pathname.startsWith('/posts/');
  const archive = pathname === '/archive';
  const crumb = post ? ' / Post' : archive ? ' / Archive' : '';
  return `<div class="wrap">
<nav class="site-nav" aria-label="TRAVNY navigation" lang="en">
  <a class="brand" href="https://bartek.lol/">TRAVNY</a>
  <a href="https://bartek.lol/teksty/">Texts</a><a href="https://bartek.lol/przeglad/">CoCzyDziennik</a>
  <a href="/" aria-current="${post || archive ? 'location' : 'page'}">Reactor</a><a href="https://bartek.lol/lab/">Lab</a>
</nav>
<header class="masthead" lang="en">
  <nav class="crumb" aria-label="Breadcrumb"><a href="https://bartek.lol/">TRAVNY</a> / <a href="/">Reactor</a>${crumb}</nav>
  <p class="eyebrow">TRAVNY · Editorial</p>
  <h1><a href="/">Reactor</a></h1>
  <div class="feeds"><a href="/">Latest</a><a href="/archive">Full archive</a><a href="/rss.xml">RSS 2.0</a><a href="/atom.xml">Atom 1.0</a><a href="/feed.json">JSON Feed 1.1</a></div>
</header>
<div class="rule" aria-hidden="true"></div>
<main class="${post ? 'reading' : 'listing'}">${body}</main>
<footer lang="en"><nav class="feeds" aria-label="More from TRAVNY"><a href="/">Reactor home</a><a href="/archive">Full archive</a><a href="https://bartek.lol/">Back to TRAVNY</a><a href="https://bartek.lol/teksty/">All texts</a></nav></footer>
</div>`;
}
