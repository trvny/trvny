import { pageSeoHead } from "./page-seo.js";

const NAV_HEAD = '<link rel="stylesheet" href="/assets/nav.css"><link rel="alternate" type="application/atom+xml" href="/teksty/feed.xml" title="TRAVNY Teksty + Reactor">';
export const NAV_BODY = `
<button id="trvny-nav-toggle" type="button" aria-controls="trvny-nav-drawer" aria-expanded="false" aria-label="Otwórz menu">☰</button>
<div id="trvny-nav-backdrop" hidden></div>
<aside id="trvny-nav-drawer" data-open="false" aria-hidden="true" aria-label="Nawigacja TRAVNY" inert>
  <div id="trvny-nav-head"><span id="trvny-nav-brand">TRAVNY</span><button id="trvny-nav-close" type="button" aria-label="Zamknij menu">×</button></div>
  <nav>
    <div class="trvny-nav-group"><span class="trvny-nav-label">START</span><a class="trvny-nav-link" href="/">Strona główna<small>hub TRAVNY</small></a><a class="trvny-nav-link" href="/tv/">TVP<small>kanały i odtwarzacz</small></a></div>
    <div class="trvny-nav-group"><span class="trvny-nav-label">USŁUGI</span><a class="trvny-nav-link" href="https://weather.travny.workers.dev/">Pogoda</a><a class="trvny-nav-link" href="https://trvny.github.io/feedseek/">Feedy</a></div>
    <div class="trvny-nav-group"><span class="trvny-nav-label">LAB</span><a class="trvny-nav-link" href="/lab/">TRAVNY Lab</a><a class="trvny-nav-link" href="https://streambench.travny.workers.dev/">Streambench</a><a class="trvny-nav-link" href="https://codebench.travny.workers.dev/">Codebench</a><a class="trvny-nav-link" href="https://docbench.travny.workers.dev/">Docbench</a><a class="trvny-nav-link" href="/papagenerator/">Papagenerator</a><a class="trvny-nav-link" href="/badges/">Badges<small>znaki i liczniki</small></a></div>
    <div class="trvny-nav-group"><span class="trvny-nav-label">TEKSTY</span><a class="trvny-nav-link" href="/teksty/">Wszystkie teksty</a><a class="trvny-nav-link" href="/przeglad/">CoCzyDziennik</a><a class="trvny-nav-link" href="/teksty/githubowa-kraina/">GitHubowa Kraina<small>atlas projektów</small></a><a class="trvny-nav-link" href="/teksty/token-worldcup/">Tokenowy Mundial AI</a></div>
  </nav>
</aside>
<script src="/assets/nav.js" defer></script>
<script src="/assets/webmcp.js" defer></script>`;

export function pageShellHead(pathname, page) {
  const canonical = page === "papagenerator"
    ? '<link rel="canonical" href="https://travny.pages.dev/papagenerator/">'
    : page === "token-worldcup"
      ? '<link rel="canonical" href="https://travny.pages.dev/teksty/token-worldcup/"><meta property="og:url" content="https://travny.pages.dev/teksty/token-worldcup/">'
      : "";
  return NAV_HEAD + pageSeoHead(pathname) + canonical;
}
