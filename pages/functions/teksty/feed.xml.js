import { getDigestPosts, publicationPath } from "../_shared/digests.js";
import { getShitposts } from "../_shared/shitpost.js";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "") // skipcq: JS-0004 — XML-invalid characters
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function getPosts(context) {
  const url = new URL("/teksty/posts.json", context.request.url);
  const response = await context.env.ASSETS.fetch(url.toString());
  if (!response.ok) throw new Error(`posts.json: ${response.status}`);
  const posts = await response.json();
  if (!Array.isArray(posts) || posts.length === 0) throw new Error("posts.json is empty");
  return posts;
}

function renderEntry(post) {
  const href = `https://travny.pages.dev${publicationPath(post)}`;
  const id = post.digest === true ? href : `https://trfny.com/teksty/${encodeURIComponent(post.slug)}/`;
  const categories = (post.tags || [])
    .map((tag) => `    <category term="${escapeXml(tag)}"/>`)
    .join("\n");
  const summary = escapeXml(`<p>${post.summary}</p>`);
  const lang = post.lang === "en" ? "en" : "pl";
  return `  <entry xml:lang="${lang}">
    <title>${escapeXml(post.title)}</title>
    <id>${id}</id>
    <link rel="alternate" href="${href}"/>
    <updated>${escapeXml(post.updated)}</updated>
${categories}
    <summary type="html">${summary}</summary>
  </entry>`;
}

function renderShitpostEntry(post) {
  const title = post.title;
  const publishedLine = post.published ? `    <published>${escapeXml(post.published)}</published>\n` : "";
  const categories = post.tags
    .map((tag) => `    <category term="${escapeXml(tag)}"/>`)
    .join("\n");
  return `  <entry xml:lang="${escapeXml(post.lang || "pl")}">
    <title>${escapeXml(title)}</title>
    <id>${escapeXml(post.id)}</id>
    <link rel="alternate" href="${escapeXml(post.url)}"/>
${publishedLine}    <updated>${escapeXml(post.updated)}</updated>
    <author><name>TRAVNY</name></author>
    <source><id>https://shitpost.trfny.com/</id><title>Reactor</title></source>
${categories}
    <summary type="text">${escapeXml(post.caption)}</summary>
  </entry>`;
}

function latestUpdated(entries) {
  return new Date(entries.reduce((latest, entry) => {
    const time = Date.parse(String(entry.updated || ""));
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0)).toISOString();
}

async function feedResponse(context, headOnly = false) {
  try {
    const [posts, digests, shitposts] = await Promise.all([getPosts(context), getDigestPosts(context), getShitposts()]);
    const entries = [
      ...[...posts, ...digests].filter((post) => publicationPath(post)).map((post) => ({ updated: post.updated, xml: renderEntry(post) })),
      ...shitposts.map((post) => ({ updated: post.updated, xml: renderShitpostEntry(post) })),
    ].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, 100);
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>TRAVNY · Teksty i Reactor</title>
  <subtitle>Essays, experiments, daily editions and Reactor entries.</subtitle>
  <id>https://trfny.com/teksty/</id>
  <link rel="alternate" href="https://travny.pages.dev/teksty/"/>
  <link rel="self" type="application/atom+xml" href="https://travny.pages.dev/teksty/feed.xml"/>
  <updated>${escapeXml(latestUpdated(entries))}</updated>
  <author><name>TRAVNY</name></author>
${entries.map((entry) => entry.xml).join("\n")}
</feed>
`;
    return new Response(headOnly ? null : xml, {
      headers: {
        "content-type": "application/atom+xml; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    const message = `Feed unavailable: ${error instanceof Error ? error.message : "unknown error"}\n`;
    return new Response(headOnly ? null : message, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export function onRequestGet(context) {
  return feedResponse(context);
}

export function onRequestHead(context) {
  return feedResponse(context, true);
}
