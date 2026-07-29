// ==UserScript==
// @name         Feed-Catcher->trvny/feeds
// @namespace    trvny
// @version      0.2.0
// @description  Detect RSS/Atom/JSON feeds on any page, one-tap add to trvny/feeds
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @homepageURL  https://trvny.github.io/feeds/reader
// @icon         https://www.mozilla.org/media/img/trademarks/feed-icon-28x28.e077f1f611f0.png
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const REPO = () => GM_getValue('repo', 'trvny/feeds');
  const TOKEN = () => GM_getValue('gh_token', '');

  const FEED_TYPES = [
    'application/rss+xml',
    'application/atom+xml',
    'application/feed+json',
    'application/json',
    'text/xml',
    'application/xml',
  ];

  const PROBE_PATHS = [
    '/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml',
    '/index.xml', '/feeds/posts/default', '/blog/feed', '/?feed=rss2',
  ];

  let feeds = [];
  let btn = null;

  // ---------- detection ----------

  function fromLinkTags() {
    const out = [];
    document.querySelectorAll('link[rel~="alternate"][type], link[rel~="feed"]').forEach((l) => {
      const type = (l.getAttribute('type') || '').toLowerCase();
      const href = l.href;
      if (!href) return;
      if (type && !FEED_TYPES.includes(type)) return;
      // generic json/xml types are noisy (manifests, sitemaps) -- require feed-ish URL
      if (/json|text\/xml|application\/xml/.test(type) && !/feed|rss|atom/i.test(href)) return;
      out.push({ url: href, title: l.getAttribute('title') || document.title || href });
    });
    return out;
  }

  function fromAnchors() {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = a.href;
      if (!/(\/feed\/?$|\/rss\/?$|\.rss$|\.atom$|feed\.xml$|rss\.xml$|atom\.xml$|index\.xml$)/i.test(h)) return;
      out.push({ url: h, title: (a.textContent || '').trim().slice(0, 80) || document.title });
    });
    return out;
  }

  // Sites that hide their feed but definitely have one.
  function fromHostRules() {
    const { hostname, pathname, href } = location;
    const out = [];
    const push = (url, title) => out.push({ url, title: title || document.title || url });

    if (/(^|\.)youtube\.com$/.test(hostname)) {
      const m = document.documentElement.innerHTML.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/);
      const ch = m ? m[1] : (pathname.match(/\/channel\/(UC[\w-]{20,})/) || [])[1];
      if (ch) push(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, `YouTube: ${document.title}`);
      const pl = (href.match(/[?&]list=([\w-]+)/) || [])[1];
      if (pl) push(`https://www.youtube.com/feeds/videos.xml?playlist_id=${pl}`, `YouTube playlist ${pl}`);
    }

    if (/(^|\.)reddit\.com$/.test(hostname)) {
      const sub = (pathname.match(/^\/r\/([\w]+)/) || [])[1];
      if (sub) push(`https://www.reddit.com/r/${sub}/.rss`, `r/${sub}`);
      const usr = (pathname.match(/^\/(?:user|u)\/([\w-]+)/) || [])[1];
      if (usr) push(`https://www.reddit.com/user/${usr}/.rss`, `u/${usr}`);
    }

    if (hostname === 'github.com') {
      const p = pathname.split('/').filter(Boolean);
      if (p.length >= 2) {
        push(`https://github.com/${p[0]}/${p[1]}/releases.atom`, `${p[0]}/${p[1]} releases`);
        push(`https://github.com/${p[0]}/${p[1]}/commits.atom`, `${p[0]}/${p[1]} commits`);
      } else if (p.length === 1) {
        push(`https://github.com/${p[0]}.atom`, `${p[0]} activity`);
      }
    }

    if (/(^|\.)substack\.com$/.test(hostname)) push(`${location.origin}/feed`, document.title);
    if (/(^|\.)medium\.com$/.test(hostname)) {
      const u = (pathname.match(/^\/(@[\w.-]+)/) || [])[1];
      push(u ? `https://medium.com/feed/${u}` : `${location.origin}/feed`, document.title);
    }
    if (/(^|\.)tumblr\.com$/.test(hostname)) push(`${location.origin}/rss`, document.title);

    return out;
  }

  function dedupe(list) {
    const m = new Map();
    for (const f of list) if (f.url && !m.has(f.url)) m.set(f.url, f);
    return [...m.values()];
  }

  function scan() {
    feeds = dedupe([...fromLinkTags(), ...fromHostRules(), ...fromAnchors()]);
    render();
    return feeds;
  }

  // ---------- deep scan (probes well-known paths) ----------

  function looksLikeFeed(text, ctype) {
    if (/rss|atom|feed\+json/i.test(ctype || '')) return true;
    const head = (text || '').slice(0, 400);
    return /<rss[\s>]|<feed[\s>]|<rdf:RDF|jsonfeed\.org/i.test(head);
  }

  function probe(url) {
    return new Promise((res) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/json;q=0.9, */*;q=0.5' },
        timeout: 8000,
        onload: (r) => {
          const ok = r.status >= 200 && r.status < 300 &&
            looksLikeFeed(r.responseText, r.responseHeaders && /content-type:\s*([^\r\n]+)/i.exec(r.responseHeaders)?.[1]);
          res(ok ? url : null);
        },
        onerror: () => res(null),
        ontimeout: () => res(null),
      });
    });
  }

  async function deepScan() {
    flash('scanning...');
    const bases = [location.origin, location.origin + location.pathname.replace(/\/[^/]*$/, '')];
    const cands = dedupe(
      bases.flatMap((b) => PROBE_PATHS.map((p) => ({ url: new URL(p, b + '/').href, title: document.title })))
    );
    const hits = (await Promise.all(cands.map((c) => probe(c.url)))).filter(Boolean);
    feeds = dedupe([...feeds, ...hits.map((u) => ({ url: u, title: document.title || u }))]);
    render();
    flash(feeds.length ? `found ${feeds.length}` : 'nothing found');
  }

  // ---------- UI ----------

  function label() {
    return feeds.length ? `+ ${feeds.length} feed${feeds.length > 1 ? 's' : ''}` : '+ feed?';
  }

  function flash(txt) {
    if (!btn) return;
    btn.textContent = txt;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => (btn.textContent = label()), 2500);
  }

  function render() {
    const show = feeds.length > 0 || GM_getValue('always_show', false);
    if (!show) { if (btn) btn.style.display = 'none'; return; }
    if (!btn) {
      btn = document.createElement('button');
      Object.assign(btn.style, {
        position: 'fixed', zIndex: 2147483647, right: '12px', bottom: '12px',
        padding: '10px 14px', borderRadius: '999px', border: 'none',
        font: '600 14px system-ui, sans-serif', color: '#fff', background: '#d6541a',
        boxShadow: '0 2px 8px rgba(0,0,0,.35)', cursor: 'pointer', opacity: '.92',
      });
      btn.title = 'click = add, long press / right click = deep scan';
      btn.addEventListener('click', onClick);
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); deepScan(); });
      let hold;
      btn.addEventListener('touchstart', () => { hold = setTimeout(deepScan, 600); }, { passive: true });
      btn.addEventListener('touchend', () => clearTimeout(hold));
      (document.body || document.documentElement).appendChild(btn);
    }
    btn.style.display = '';
    btn.textContent = label();
  }

  function onClick() {
    if (!feeds.length) return deepScan();
    if (feeds.length === 1) return addFeed(feeds[0]);
    const i = prompt('Add which feed?\n' + feeds.map((f, n) => `${n + 1}. ${f.title}\n   ${f.url}`).join('\n'), '1');
    const idx = parseInt(i, 10) - 1;
    if (feeds[idx]) addFeed(feeds[idx]);
  }

  // ---------- submit ----------

  function addFeed(feed) {
    const token = TOKEN();
    return token ? dispatch(feed, token) : openIssue(feed);
  }

  function openIssue(feed) {
    const title = encodeURIComponent(`Add feed: ${feed.title}`);
    const body = encodeURIComponent(`Feed: ${feed.url}\nSource: ${location.href}`);
    window.open(`https://github.com/${REPO()}/issues/new?title=${title}&body=${body}`, '_blank');
  }

  function dispatch(feed, token) {
    flash('sending...');
    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://api.github.com/repos/${REPO()}/dispatches`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        event_type: 'add-feed',
        client_payload: { feed_url: feed.url, title: feed.title, source: location.href },
      }),
      onload: (r) => flash(r.status === 204 ? 'sent ok' : `err ${r.status}`),
      onerror: () => flash('net err'),
    });
  }

  // ---------- menu ----------

  GM_registerMenuCommand('Scan this page for feeds', () => {
    scan();
    flash(feeds.length ? `found ${feeds.length}` : 'nothing in HTML');
    if (!feeds.length) deepScan();
  });
  GM_registerMenuCommand('Add current URL as feed', () => addFeed({ url: location.href, title: document.title }));
  GM_registerMenuCommand('Set GitHub token (optional)', () => {
    const t = prompt('GitHub PAT (contents+actions scope). Blank = prefilled-issue mode:', TOKEN());
    if (t !== null) GM_setValue('gh_token', t.trim());
  });
  GM_registerMenuCommand('Set target repo', () => {
    const r = prompt('owner/repo:', REPO());
    if (r) GM_setValue('repo', r.trim());
  });
  GM_registerMenuCommand(`Always show button: ${GM_getValue('always_show', false) ? 'ON' : 'OFF'}`, () => {
    GM_setValue('always_show', !GM_getValue('always_show', false));
    render();
  });

  // ---------- boot + SPA re-scan ----------

  scan();

  let last = location.href;
  setInterval(() => {
    if (location.href !== last) { last = location.href; scan(); }
  }, 1500);

  const mo = new MutationObserver(() => {
    if (mo._q) return;
    mo._q = true;
    setTimeout(() => { mo._q = false; if (!feeds.length) scan(); }, 1200);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
