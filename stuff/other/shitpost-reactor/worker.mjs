import { iconAsset } from './icons.mjs';
import { getMemeTemplate, memeImageUrl } from './templates.mjs';

const SITE_URL = 'https://shitpost.trfny.com';
const FEED_TITLE = 'Shitpost Reactor';
const FEED_DESCRIPTION = 'Automatycznie generowane polskie shitposty z Shitpost Reactora.';
const FEED_LIMIT = 50;
const INDEX_LIMIT = 250;
const MAX_BODY_BYTES = 64 * 1024;
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const OIDC_CONFIG_URL = `${OIDC_ISSUER}/.well-known/openid-configuration`;
const OIDC_AUDIENCE = SITE_URL;
const EXPECTED_REPOSITORY = 'trvny/trvny';
const EXPECTED_REF = 'refs/heads/main';
const EXPECTED_WORKFLOW_REF = `${EXPECTED_REPOSITORY}/.github/workflows/shitpost-reactor.yml@${EXPECTED_REF}`;
const ALLOWED_EVENTS = new Set(['schedule', 'workflow_dispatch']);

function isXml10Char(char) {
  const code = char.codePointAt(0);
  return code === 0x09
    || code === 0x0A
    || code === 0x0D
    || (code >= 0x20 && code <= 0xD7FF)
    || (code >= 0xE000 && code <= 0xFFFD)
    || (code >= 0x10000 && code <= 0x10FFFF);
}

function cleanXml(value) {
  return Array.from(String(value ?? '')).filter(isXml10Char).join('');
}

export function escapeXml(value) {
  return cleanXml(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeHtml(value) {
  return cleanXml(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function shortTitle(caption) {
  const oneLine = caption.replace(/\s+/gu, ' ').trim();
  return oneLine.length <= 120 ? oneLine : `${oneLine.slice(0, 117)}...`;
}

function nonEmptyString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${field}`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`invalid_${field}_length`);
  return result;
}

export function validateRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_record');
  if (input.schema_version !== 1 && input.schema_version !== 2) throw new Error('invalid_schema_version');
  const generatedAt = nonEmptyString(input.generated_at, 'generated_at', 64);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('invalid_generated_at');

  const skill = input.skill;
  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error('invalid_skill');

  let topic = null;
  if (input.topic !== null && input.topic !== undefined) {
    topic = nonEmptyString(input.topic, 'topic', 2_000);
  }

  const common = {
    schema_version: input.schema_version,
    generated_at: new Date(generatedAt).toISOString(),
    provider: nonEmptyString(input.provider, 'provider', 200),
    model: nonEmptyString(input.model, 'model', 200),
    skill: {
      source: nonEmptyString(skill.source, 'skill_source', 2_000),
      sha256: nonEmptyString(skill.sha256, 'skill_sha256', 128),
    },
    topic,
  };

  if (input.schema_version === 1) {
    const meme = input.meme;
    if (!meme || typeof meme !== 'object' || Array.isArray(meme)) throw new Error('invalid_meme');
    return {
      ...common,
      meme: {
        dialect: nonEmptyString(meme.dialect, 'dialect', 200),
        format: nonEmptyString(meme.format, 'format', 200),
        caption: nonEmptyString(meme.caption, 'caption', 700),
        visual: nonEmptyString(meme.visual, 'visual', 2_000),
        alt_text: nonEmptyString(meme.alt_text, 'alt_text', 1_000),
      },
    };
  }

  const content = input.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('invalid_content');
  if (content.kind === 'text') {
    return {
      ...common,
      content: {
        kind: 'text',
        text: nonEmptyString(content.text, 'text', 700),
      },
    };
  }
  if (content.kind === 'meme') {
    const template = nonEmptyString(content.template, 'template', 80);
    if (!getMemeTemplate(template)) throw new Error('invalid_meme_template');
    if (typeof content.top_text !== 'string' || typeof content.bottom_text !== 'string') {
      throw new Error('invalid_meme_text');
    }
    const topText = content.top_text.trim();
    const bottomText = content.bottom_text.trim();
    if (!topText && !bottomText) throw new Error('invalid_meme_text');
    if (topText.length > 220 || bottomText.length > 220) throw new Error('invalid_meme_text_length');
    return {
      ...common,
      content: {
        kind: 'meme',
        template,
        top_text: topText,
        bottom_text: bottomText,
      },
    };
  }
  throw new Error('invalid_content_kind');
}

function normalizeIndex(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    if (!/^gh-\d+-\d+$/u.test(item.id || '')) continue;
    if (!Number.isFinite(Date.parse(item.published_at || ''))) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({ id: item.id, published_at: new Date(item.published_at).toISOString() });
  }
  return result
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, INDEX_LIMIT);
}

async function readIndex(env) {
  const object = await env.FEED.get('index.json');
  if (!object) return [];
  try {
    return normalizeIndex(await object.json());
  } catch {
    return [];
  }
}

async function writeIndex(env, index) {
  await env.FEED.put('index.json', `${JSON.stringify(normalizeIndex(index), null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

async function ensureIndexed(env, post) {
  const index = await readIndex(env);
  const next = [{ id: post.id, published_at: post.published_at }, ...index.filter((entry) => entry.id !== post.id)];
  await writeIndex(env, next);
}

async function readPost(env, id) {
  const object = await env.FEED.get(`posts/${id}.json`);
  if (!object) return null;
  try {
    return await object.json();
  } catch {
    return null;
  }
}

async function readPosts(env, limit = FEED_LIMIT) {
  const index = (await readIndex(env)).slice(0, limit);
  const posts = await Promise.all(index.map((entry) => readPost(env, entry.id)));
  return posts.filter(Boolean);
}

function postSummary(post) {
  if (post.schema_version === 2 && post.content?.kind === 'text') return post.content.text;
  if (post.schema_version === 2 && post.content?.kind === 'meme') {
    return [post.content.top_text, post.content.bottom_text].filter(Boolean).join(' / ');
  }
  return post.meme?.caption || 'Shitpost';
}

function postKind(post) {
  return post.schema_version === 2 ? post.content?.kind || 'text' : 'text';
}

function postImageUrl(post) {
  if (post.schema_version !== 2 || post.content?.kind !== 'meme') return null;
  return memeImageUrl(post.content.template, post.content.top_text, post.content.bottom_text);
}

function postAlt(post) {
  if (post.schema_version !== 2 || post.content?.kind !== 'meme') return postSummary(post);
  const template = getMemeTemplate(post.content.template);
  const text = [post.content.top_text, post.content.bottom_text].filter(Boolean).join(' / ');
  return `${template?.name || 'Meme'}: ${text}`;
}

function postHtml(post) {
  const image = postImageUrl(post);
  const content = image
    ? `<figure><img class="meme" src="${escapeHtml(image)}" alt="${escapeHtml(postAlt(post))}" loading="eager"></figure>`
    : `<h1>${escapeHtml(postSummary(post)).replaceAll('\n', '<br>')}</h1>`;
  return `<article>${content}<p class="meta"><time datetime="${escapeHtml(post.generated_at)}">${escapeHtml(post.generated_at)}</time></p></article>`;
}

function feedContentHtml(post) {
  const image = postImageUrl(post);
  if (image) {
    return `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(postAlt(post))}"></p>`;
  }
  return `<p>${escapeHtml(postSummary(post)).replaceAll('\n', '<br>')}</p>`;
}

export function renderRss(posts) {
  const latest = posts[0]?.published_at || new Date(0).toISOString();
  const items = posts.map((post) => {
    const summary = postSummary(post);
    return `    <item>
      <title>${escapeXml(shortTitle(summary))}</title>
      <link>${escapeXml(post.url)}</link>
      <guid isPermaLink="true">${escapeXml(post.url)}</guid>
      <pubDate>${escapeXml(new Date(post.published_at).toUTCString())}</pubDate>
      <category>${escapeXml(postKind(post))}</category>
      <description>${escapeXml(summary)}</description>
      <content:encoded>${cdata(feedContentHtml(post))}</content:encoded>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(`${SITE_URL}/`)}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>pl-PL</language>
    <lastBuildDate>${escapeXml(new Date(latest).toUTCString())}</lastBuildDate>
    <generator>trvny/shitpost-reactor</generator>
    <ttl>5</ttl>
    <image>
      <url>${escapeXml(`${SITE_URL}/favicon-96x96.png`)}</url>
      <title>${escapeXml(FEED_TITLE)}</title>
      <link>${escapeXml(`${SITE_URL}/`)}</link>
      <width>96</width>
      <height>96</height>
    </image>
    <atom:link href="${escapeXml(`${SITE_URL}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

export function renderAtom(posts) {
  const latest = posts[0]?.published_at || new Date(0).toISOString();
  const entries = posts.map((post) => {
    const summary = postSummary(post);
    const html = feedContentHtml(post);
    return `  <entry>
    <title>${escapeXml(shortTitle(summary))}</title>
    <id>${escapeXml(post.url)}</id>
    <link href="${escapeXml(post.url)}" rel="alternate" type="text/html" />
    <published>${escapeXml(post.published_at)}</published>
    <updated>${escapeXml(post.published_at)}</updated>
    <category term="${escapeXml(postKind(post))}" />
    <summary type="text">${escapeXml(summary)}</summary>
    <content type="html">${escapeXml(html)}</content>
  </entry>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="pl">
  <title>${escapeXml(FEED_TITLE)}</title>
  <subtitle>${escapeXml(FEED_DESCRIPTION)}</subtitle>
  <id>${escapeXml(`${SITE_URL}/`)}</id>
  <link href="${escapeXml(`${SITE_URL}/`)}" rel="alternate" type="text/html" />
  <link href="${escapeXml(`${SITE_URL}/atom.xml`)}" rel="self" type="application/atom+xml" />
  <updated>${escapeXml(latest)}</updated>
  <generator uri="https://github.com/trvny/trvny">trvny/shitpost-reactor</generator>
  <icon>${escapeXml(`${SITE_URL}/favicon.svg`)}</icon>
  <logo>${escapeXml(`${SITE_URL}/icon-512.png`)}</logo>
  <author><name>Shitpost Reactor</name></author>
${entries}
</feed>
`;
}

export function renderJsonFeed(posts) {
  return `${JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: FEED_TITLE,
    home_page_url: `${SITE_URL}/`,
    feed_url: `${SITE_URL}/feed.json`,
    description: FEED_DESCRIPTION,
    language: 'pl-PL',
    icon: `${SITE_URL}/icon-512.png`,
    favicon: `${SITE_URL}/favicon-32x32.png`,
    items: posts.map((post) => {
      const summary = postSummary(post);
      const image = postImageUrl(post);
      return {
        id: post.url,
        url: post.url,
        title: shortTitle(summary),
        content_html: feedContentHtml(post),
        summary,
        date_published: post.published_at,
        date_modified: post.published_at,
        tags: [postKind(post)],
        ...(image ? { image } : {}),
      };
    }),
  }, null, 2)}\n`;
}

function renderSitemap(posts) {
  const urls = [`  <url><loc>${escapeXml(`${SITE_URL}/`)}</loc></url>`, ...posts.map((post) => `  <url><loc>${escapeXml(post.url)}</loc><lastmod>${escapeXml(post.published_at)}</lastmod></url>`)].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderRobots() {
  return `# AI crawlers and user-triggered fetchers explicitly welcome.
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: OAI-AdsBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: Applebot
User-agent: Applebot-Extended
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /

User-agent: *
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

function renderLlms() {
  return `# Shitpost Reactor

> Public archive and machine-readable feeds of automatically generated Polish shitposts.

Canonical site: ${SITE_URL}/

## Main routes

- [Archive](${SITE_URL}/)
- [RSS 2.0](${SITE_URL}/rss.xml)
- [Atom 1.0](${SITE_URL}/atom.xml)
- [JSON Feed 1.1](${SITE_URL}/feed.json)

## Content

- New entries are generated by the scheduled Shitpost Reactor workflow in \`trvny/trvny\`.
- Style instructions come from the canonical \`trvny/.ai/skills/edgy-dark-meme.zip\` skill instead of being duplicated here.
- Each published entry has a stable canonical URL under \`/posts/gh-<run_id>-<run_attempt>\`.
- Feeds expose the caption, dialect, format, publication time and a compact visual brief.

## Discovery

- [Sitemap](${SITE_URL}/sitemap.xml)
- [Robots policy](${SITE_URL}/robots.txt)
- [Web manifest](${SITE_URL}/site.webmanifest)
- [Source](https://github.com/trvny/trvny/tree/main/stuff/other/shitpost-reactor)
`;
}

function renderManifest() {
  return `${JSON.stringify({
    id: '/',
    name: FEED_TITLE,
    short_name: 'Shitpost',
    description: FEED_DESCRIPTION,
    lang: 'pl-PL',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    categories: ['entertainment'],
    background_color: '#111111',
    theme_color: '#111111',
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2)}\n`;
}

function renderBrowserConfig() {
  return `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="/mstile-150x150.png"/>
      <TileColor>#111111</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`;
}

function htmlPage(title, body, canonicalUrl = `${SITE_URL}/`, socialImage = `${SITE_URL}/icon-512.png`) {
  return `<!doctype html><html lang="pl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(FEED_DESCRIPTION)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#111111">
<meta name="msapplication-TileColor" content="#111111">
<meta name="msapplication-TileImage" content="/mstile-150x150.png">
<meta property="og:locale" content="pl_PL">
<meta property="og:site_name" content="${escapeHtml(FEED_TITLE)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(FEED_DESCRIPTION)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(socialImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(FEED_DESCRIPTION)}">
<meta name="twitter:image" content="${escapeHtml(socialImage)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="${escapeHtml(FEED_TITLE)} llms.txt">
<link rel="describedby" href="/llms.txt" title="${escapeHtml(FEED_TITLE)} llms.txt">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(FEED_TITLE)} RSS" href="/rss.xml">
<link rel="alternate" type="application/atom+xml" title="${escapeHtml(FEED_TITLE)} Atom" href="/atom.xml">
<link rel="alternate" type="application/feed+json" title="${escapeHtml(FEED_TITLE)} JSON Feed" href="/feed.json">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="mask-icon" href="/favicon.svg" color="#f5e94e">
<link rel="manifest" href="/site.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Shitpost">
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1rem;background:#111;color:#eee}a{color:#9ad}article{padding:1.2rem 0;border-bottom:1px solid #333}h1{font-size:1.35rem;white-space:pre-wrap}dt{font-weight:700;margin-top:.6rem}dd{margin-left:0;color:#bbb}.feeds{display:flex;gap:1rem;flex-wrap:wrap}.meta{color:#999;font-size:.9rem}.meme{display:block;max-width:100%;height:auto;margin:1rem 0;border-radius:.5rem}</style>
</head><body><header><h1>${escapeHtml(FEED_TITLE)}</h1><p class="feeds"><a href="/rss.xml">RSS 2.0</a><a href="/atom.xml">Atom 1.0</a><a href="/feed.json">JSON Feed 1.1</a></p></header>${body}</body></html>`;
}

function response(body, contentType, { cache = 'public, max-age=300, stale-while-revalidate=600', status = 200, lastModified } = {}) {
  const headers = new Headers({
    'content-type': contentType,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  if (lastModified) headers.set('last-modified', new Date(lastModified).toUTCString());
  return new Response(body, { status, headers });
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function audienceMatches(aud) {
  return typeof aud === 'string' ? aud === OIDC_AUDIENCE : Array.isArray(aud) && aud.includes(OIDC_AUDIENCE);
}

export function validateOidcClaims(claims, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!claims || typeof claims !== 'object') throw new Error('oidc_invalid_claims');
  if (claims.iss !== OIDC_ISSUER) throw new Error('oidc_invalid_issuer');
  if (!audienceMatches(claims.aud)) throw new Error('oidc_invalid_audience');
  if (claims.repository !== EXPECTED_REPOSITORY) throw new Error('oidc_invalid_repository');
  if (claims.ref !== EXPECTED_REF) throw new Error('oidc_invalid_ref');
  if (claims.workflow_ref !== EXPECTED_WORKFLOW_REF) throw new Error('oidc_invalid_workflow');
  if (!ALLOWED_EVENTS.has(claims.event_name)) throw new Error('oidc_invalid_event');
  if (claims.runner_environment !== 'github-hosted') throw new Error('oidc_invalid_runner');
  if (!/^\d+$/u.test(String(claims.run_id || ''))) throw new Error('oidc_invalid_run_id');
  if (!/^\d+$/u.test(String(claims.run_attempt || ''))) throw new Error('oidc_invalid_run_attempt');
  const skew = 60;
  if (!Number.isFinite(claims.exp) || claims.exp < nowSeconds - skew) throw new Error('oidc_expired');
  if (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + skew) throw new Error('oidc_not_yet_valid');
  if (Number.isFinite(claims.iat) && claims.iat > nowSeconds + skew) throw new Error('oidc_issued_in_future');
  return claims;
}

async function verifyGithubOidc(token, fetchImpl = fetch) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('oidc_invalid_token');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('oidc_invalid_header');

  const configResponse = await fetchImpl(OIDC_CONFIG_URL, { headers: { accept: 'application/json' } });
  if (!configResponse.ok) throw new Error('oidc_config_unavailable');
  const config = await configResponse.json();
  if (config.issuer !== OIDC_ISSUER || typeof config.jwks_uri !== 'string') {
    throw new Error('oidc_invalid_config');
  }
  let jwksUrl = null;
  try {
    jwksUrl = new URL(config.jwks_uri);
  } catch {
    throw new Error('oidc_invalid_config');
  }
  if (jwksUrl.origin !== OIDC_ISSUER || jwksUrl.protocol !== 'https:' || jwksUrl.username || jwksUrl.password) {
    throw new Error('oidc_invalid_config');
  }

  const jwksResponse = await fetchImpl(jwksUrl, { headers: { accept: 'application/json' } });
  if (!jwksResponse.ok) throw new Error('oidc_jwks_unavailable');
  const jwks = await jwksResponse.json();
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((key) => key.kid === header.kid && key.kty === 'RSA') : null;
  if (!jwk) throw new Error('oidc_key_not_found');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new Error('oidc_invalid_signature');
  return validateOidcClaims(claims);
}

async function publish(request, env) {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY_BYTES) return response('payload too large\n', 'text/plain; charset=utf-8', { status: 413, cache: 'no-store' });

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return response('unauthorized\n', 'text/plain; charset=utf-8', { status: 401, cache: 'no-store' });

  let claims = null;
  try {
    claims = await verifyGithubOidc(authorization.slice(7).trim());
  } catch {
    return response('unauthorized\n', 'text/plain; charset=utf-8', { status: 401, cache: 'no-store' });
  }

  let source = null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('payload_too_large');
    source = validateRecord(JSON.parse(text));
  } catch {
    return response('invalid payload\n', 'text/plain; charset=utf-8', { status: 400, cache: 'no-store' });
  }

  const id = `gh-${claims.run_id}-${claims.run_attempt}`;
  const existing = await readPost(env, id);
  if (existing) {
    await ensureIndexed(env, existing);
    return response(`${JSON.stringify({ ok: true, id, url: existing.url, duplicate: true })}\n`, 'application/json; charset=utf-8', { cache: 'no-store' });
  }

  const publishedAt = new Date().toISOString();
  const post = { ...source, id, published_at: publishedAt, url: `${SITE_URL}/posts/${id}` };
  await env.FEED.put(`posts/${id}.json`, `${JSON.stringify(post, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { published_at: publishedAt, run_id: String(claims.run_id) },
  });
  await ensureIndexed(env, post);

  return response(`${JSON.stringify({ ok: true, id, url: post.url, duplicate: false })}\n`, 'application/json; charset=utf-8', { status: 201, cache: 'no-store' });
}

async function handleGet(url, env) {
  if (url.pathname === '/healthz') return response('ok\n', 'text/plain; charset=utf-8', { cache: 'no-store' });

  const icon = iconAsset(url.pathname);
  if (icon) return response(icon.body, icon.contentType, { cache: 'public, max-age=31536000, immutable' });

  if (url.pathname === '/robots.txt') return response(renderRobots(), 'text/plain; charset=utf-8', { cache: 'public, max-age=86400' });
  if (url.pathname === '/llms.txt') return response(renderLlms(), 'text/plain; charset=utf-8', { cache: 'public, max-age=3600' });
  if (url.pathname === '/site.webmanifest' || url.pathname === '/manifest.json') {
    return response(renderManifest(), 'application/manifest+json; charset=utf-8', { cache: 'public, max-age=86400' });
  }
  if (url.pathname === '/browserconfig.xml') {
    return response(renderBrowserConfig(), 'application/xml; charset=utf-8', { cache: 'public, max-age=86400' });
  }

  const match = url.pathname.match(/^\/posts\/(gh-\d+-\d+)$/u);
  if (match) {
    const post = await readPost(env, match[1]);
    if (!post) return response('not found\n', 'text/plain; charset=utf-8', { status: 404, cache: 'public, max-age=60' });
    const summary = postSummary(post);
    return response(htmlPage(shortTitle(summary), postHtml(post), post.url, postImageUrl(post) || `${SITE_URL}/icon-512.png`), 'text/html; charset=utf-8', { cache: 'public, max-age=86400, immutable', lastModified: post.published_at });
  }

  const aggregatePaths = new Set(['/', '/rss.xml', '/feed.xml', '/atom.xml', '/feed.json', '/sitemap.xml']);
  if (!aggregatePaths.has(url.pathname)) {
    return response('not found\n', 'text/plain; charset=utf-8', { status: 404, cache: 'public, max-age=60' });
  }

  const posts = await readPosts(env);
  const latest = posts[0]?.published_at;
  if (url.pathname === '/rss.xml' || url.pathname === '/feed.xml') {
    return response(renderRss(posts), 'application/rss+xml; charset=utf-8', { lastModified: latest });
  }
  if (url.pathname === '/atom.xml') {
    return response(renderAtom(posts), 'application/atom+xml; charset=utf-8', { lastModified: latest });
  }
  if (url.pathname === '/feed.json') {
    return response(renderJsonFeed(posts), 'application/feed+json; charset=utf-8', { lastModified: latest });
  }
  if (url.pathname === '/sitemap.xml') {
    return response(renderSitemap(posts), 'application/xml; charset=utf-8', { lastModified: latest });
  }

  const items = posts.slice(0, 20).map((post) => {
    const summary = postSummary(post);
    const image = postImageUrl(post);
    const preview = image
      ? `<a href="/posts/${escapeHtml(post.id)}"><img class="meme" src="${escapeHtml(image)}" alt="${escapeHtml(postAlt(post))}" loading="lazy"></a>`
      : `<p>${escapeHtml(summary).replaceAll('\n', '<br>')}</p>`;
    return `<article><h2><a href="/posts/${escapeHtml(post.id)}">${escapeHtml(shortTitle(summary))}</a></h2>${preview}<p class="meta">${escapeHtml(post.published_at)}</p></article>`;
  }).join('');
  return response(htmlPage(FEED_TITLE, items || '<p>Jeszcze pusto. Automat dopiero ostrzy kredki.</p>'), 'text/html; charset=utf-8', { lastModified: latest });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/publish') return publish(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response('method not allowed\n', 'text/plain; charset=utf-8', { status: 405, cache: 'no-store' });
    }
    const result = await handleGet(url, env);
    if (request.method === 'HEAD') return new Response(null, { status: result.status, headers: result.headers });
    return result;
  },
};
