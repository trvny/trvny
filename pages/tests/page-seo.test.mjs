import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pageSeoHead } from "../functions/_shared/page-seo.js";

function crumbs(path) {
  const html = pageSeoHead(path);
  const tag = '<script type="application/ld+json">';
  const begin = html.indexOf(tag);
  if (begin === -1) return null;
  const from = begin + tag.length;
  return JSON.parse(html.slice(from, html.indexOf("</script>", from)));
}

function parseUserAgents(block) {
  return block
    .map(line => /^\s*user-agent:\s*(.*?)\s*$/i.exec(line)?.[1]?.trim().toLowerCase())
    .filter(Boolean);
}

test("Astro Lab canonical URLs and discovery routes agree", async () => {
  const sitemap = await readFile(new URL("../site/sitemap.xml", import.meta.url), "utf8");
  const guides = [
    await readFile(new URL("../site/llms.txt", import.meta.url), "utf8"),
    await readFile(new URL("../site/llms-full.txt", import.meta.url), "utf8"),
  ];
  const lab = await readFile(new URL("../astro/dist/lab/index.html", import.meta.url), "utf8");
  const labUrl = "https://travny.pages.dev/lab/";
  assert.ok(lab.includes(`<link rel="canonical" href="${labUrl}"`), "canonical missing: /lab/");
  assert.ok(lab.includes(`<meta property="og:url" content="${labUrl}"`), "OG URL missing: /lab/");
  assert.match(lab, /<html lang="en">/);
  assert.match(lab, /<meta name="robots" content="index,follow"/);
  assert.ok(sitemap.includes(`<loc>${labUrl}</loc>`), "sitemap missing: /lab/");
  assert.ok(guides[1].split(/\r?\n/).some(line => line.trimEnd().endsWith(labUrl)), "full LLM guide missing: /lab/");

  // Field notes: working notebook, linked from the lab but not indexed or advertised.
  const notesUrl = "https://travny.pages.dev/lab/field-notes/";
  const notes = await readFile(new URL("../astro/dist/lab/field-notes/index.html", import.meta.url), "utf8");
  assert.match(notes, /<meta name="robots" content="noindex,follow"/);
  assert.ok(!notes.includes('rel="canonical"'), "noindex page must not declare a canonical");
  assert.ok(!sitemap.includes(notesUrl), "noindex page listed in sitemap");
  for (const guide of guides) assert.ok(!guide.includes(notesUrl), "noindex page listed in LLM guide");
  assert.ok(lab.includes('href="/lab/field-notes/"'), "lab must still link the notes");
});

test("breadcrumb trails reflect the public page hierarchy", () => {
  const schema = crumbs("/teksty/grass-mud-horse/");
  assert.equal(schema["@type"], "BreadcrumbList");
  assert.deepEqual(schema.itemListElement.map(({ position, name, item }) => [position, name, item]), [
    [1, "TRAVNY", "https://travny.pages.dev/"],
    [2, "Teksty", "https://travny.pages.dev/teksty/"],
    [3, "Alpaka, krab i Wielki Harmonizator", "https://travny.pages.dev/teksty/grass-mud-horse/"],
  ]);
});

test("canonicalized route aliases share one trail", () => {
  assert.deepEqual(crumbs("/teksty/token-worldcup/"), crumbs("/teksty/token-worldcup/token-worldcup.html"));
  assert.deepEqual(crumbs("/teksty/grass-mud-horse/index.html"), crumbs("/teksty/grass-mud-horse"));
  assert.equal(pageSeoHead("/teksty/grass-mud-horse-pl/"), "");
  assert.equal(pageSeoHead("/"), "");
  assert.equal(pageSeoHead("/does-not-exist"), "");
});

test("effort matrix is noindex with a distinct breadcrumb", async () => {
  const url = "https://travny.pages.dev/teksty/token-worldcup/effort-matrix";
  const tags = pageSeoHead("/teksty/token-worldcup/effort-matrix");
  assert.equal(tags, pageSeoHead("/teksty/token-worldcup/effort-matrix.html"));
  assert.ok(tags.includes('<meta name="robots" content="noindex,follow">'));
  assert.ok(!tags.includes('rel="canonical"'), "noindex page must not declare a canonical");
  const schema = crumbs("/teksty/token-worldcup/effort-matrix");
  assert.equal(schema.itemListElement.length, 4);
  assert.equal(schema.itemListElement.at(-1).item, url);
  assert.ok(!pageSeoHead("/teksty/token-worldcup/").includes("noindex"));
  const sitemap = await readFile(new URL("../site/sitemap.xml", import.meta.url), "utf8");
  assert.ok(!sitemap.includes("effort-matrix"), "noindex page listed in sitemap");
  for (const name of ["llms.txt", "llms-full.txt"]) {
    const guide = await readFile(new URL(`../site/${name}`, import.meta.url), "utf8");
    assert.ok(!guide.includes("effort-matrix"), `noindex page listed in ${name}`);
  }
  assert.deepEqual(crumbs("/teksty/githubowa-kraina/universe"), crumbs("/teksty/githubowa-kraina/universe.html"));
});

test("robots normalize user-agent tokens with case and spacing variations", () => {
  const variants = ["User-agent: GPTBot", "  user-agent:  gPtBoT  ", "USER-AGENT:\tGPTBot"];
  assert.deepEqual(parseUserAgents(variants), ["gptbot", "gptbot", "gptbot"]);
  assert.deepEqual(parseUserAgents(["  User-agent: *  ", "Allow: /"]), ["*"]);
});

test("robots explicitly allow mainstream search and Mistral agents", async () => {
  const robots = await readFile(new URL("../site/robots.txt", import.meta.url), "utf8");
  const groups = robots.split(/\r?\n\s*\r?\n/).map(block => block.split(/\r?\n/));
  const crawlers = [
    "GPTBot",
    "PerplexityBot",
    "Perplexity-User",
    "KimiBot",
    "Kimi-SearchBot",
    "Kimi-User",
    "Meta-WebIndexer",
    "Meta-ExternalFetcher",
    "Meta-ExternalAgent",
    "Googlebot",
    "Googlebot-News",
    "Googlebot-Image",
    "Googlebot-Video",
    "GoogleOther",
    "GoogleOther-Image",
    "GoogleOther-Video",
    "Google-InspectionTool",
    "DuckDuckBot",
    "YandexBot",
    "YandexFavicons",
    "CCBot",
    "SemanticScholarBot",
    "MistralAI-Index",
    "MistralAI-Training",
    "MistralAI-User",
  ];
  for (const crawler of crawlers) {
    const matches = groups.filter(group => parseUserAgents(group).includes(crawler.toLowerCase()));
    assert.equal(matches.length, 1, `crawler group missing or duplicated: ${crawler}`);
    assert.ok(matches[0].includes("Allow: /"), `crawler not allowed: ${crawler}`);
    assert.ok(!matches[0].some(line => /^\s*disallow:/i.test(line)), `crawler disallowed: ${crawler}`);
    assert.ok(matches[0].includes("Content-Signal: ai-train=yes, search=yes, ai-input=yes"));
  }
  const declared = groups.flatMap(group => parseUserAgents(group));
  assert.equal(declared.length, new Set(declared).size, "duplicate user-agent tokens");
  const wildcard = groups.filter(group => parseUserAgents(group).includes("*"));
  assert.equal(wildcard.length, 1, "wildcard group missing or duplicated");
  assert.ok(wildcard[0].includes("Allow: /"));
  assert.ok(!wildcard[0].some(line => /^\s*disallow:/i.test(line)));
  assert.ok(wildcard[0].includes("Content-Signal: ai-train=yes, search=yes, ai-input=yes"));
  assert.ok(robots.includes("Sitemap: https://travny.pages.dev/sitemap.xml"));
  assert.ok(robots.includes("Sitemap: https://travny.pages.dev/przeglad/sitemap.xml"));
});
