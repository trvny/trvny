'use strict';

// Publication hooks only. No scheduled crawler, persistent state or indexing guarantees.
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const HUB = 'https://travny.pages.dev';
const REACTOR = 'https://shitpost-reactor.travny.workers.dev';
const FEEDSEEK = 'https://trvny.github.io/feedseek/';
const SITES = {
  hub: { root: HUB + '/', key: 'e5c82dc398a4a68a5dc77951901293a9' },
  reactor: { root: REACTOR + '/', key: '3d7f6f7c227e7f3cd4010a286e1e6065', pages: [REACTOR + '/', REACTOR + '/archive'] },
  feedseek: { root: FEEDSEEK, key: '81245951337e900395962c61557b6ac6', pages: [FEEDSEEK, FEEDSEEK + 'reader/'] },
  codebench: { root: 'https://codebench.travny.workers.dev/', key: '281aa1aafbb3f6d4d5384132bf3b6542' },
  docbench: { root: 'https://docbench.travny.workers.dev/', key: 'b7831eb1aadc5c992606547cdbb615f9' },
  streambench: { root: 'https://streambench.travny.workers.dev/', key: '51cad3603d5fce8b8d6dd3c1a55e8142' },
  weather: { root: 'https://weather.travny.workers.dev/', key: 'd715f047a08ac671e4dc69cc036a7410' },
};

const digestPath = /^pages\/astro\/src\/content\/digests\/(\d{4}-\d{2}-\d{2})\.md$/;
const sitePath = /^pages\/(?:site\/|astro\/|papagenerator\/|functions\/|scripts\/(?:sitemap-variants|build-badge-previews|build-static-shell)\.mjs$|build\.sh$)/;

function digestUrls(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid digest date');
  return [HUB + '/przeglad/' + date + '/', HUB + '/przeglad/', HUB + '/teksty/'];
}

function hubUrls(paths, sitemap) {
  const urls = new Set();
  let shared = false;
  for (const path of paths) {
    const digest = digestPath.exec(path);
    if (digest) digestUrls(digest[1]).forEach(url => urls.add(url));
    else if (sitePath.test(path)) shared = true;
  }
  // Changed shared site assets may affect several static pages. The checked-in
  // sitemap contains only permanent routes; never fetch/crawl historical issues.
  if (shared) for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(match[1]);
  return [...urls].sort();
}

function canonical(site, url) {
  const root = new URL(site.root);
  const target = new URL(url);
  return target.origin === root.origin && target.href === url &&
    !target.search && !target.hash && !target.username && !target.password &&
    target.pathname.startsWith(root.pathname);
}

async function notify(name, urls, { fetchImpl = fetch, log = console.log, warn = console.warn } = {}) {
  const site = SITES[name];
  try {
    if (!site) throw Error('Unknown IndexNow site');
    const list = [...new Set(urls ?? site.pages ?? [site.root])];
    if (!list.length) return true;
    if (!list.every(url => canonical(site, url))) throw Error('URL outside canonical ownership scope');
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      const result = await fetchImpl('https://api.indexnow.org/indexnow', {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: new URL(site.root).host, key: site.key,
          keyLocation: site.root + site.key + '.txt', urlList: batch }),
        signal: AbortSignal.timeout(10_000),
      });
      if (![200, 202].includes(result.status)) throw Error('HTTP ' + result.status);
      log(`IndexNow accepted ${batch.length} ${name} URL(s): HTTP ${result.status}`);
    }
    return true;
  } catch (error) {
    // IndexNow is advisory; never fail a successful publication.
    warn(`IndexNow ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

if (require.main === module) {
  const [name, ...args] = process.argv.slice(2);
  if (name === 'hub-changes') {
    const [before, head] = args;
    const sitemap = readFileSync('site/sitemap.xml', 'utf8');
    const changed = /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before)
      ? execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', before, head, '--'], { cwd: '..', encoding: 'utf8' }).split('\0')
      : ['pages/build.sh'];
    process.stdout.write(JSON.stringify(hubUrls(changed, sitemap)));
  } else {
    const urls = args.length ? JSON.parse(args[0]) : undefined;
    void notify(name, urls, { warn: message => console.warn('::warning::' + message) });
  }
}

module.exports = { notify, hubUrls, digestUrls };
