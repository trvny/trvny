import test from "node:test";
import assert from "node:assert/strict";

import { pageSeoHead } from "../functions/_shared/page-seo.js";

function crumbs(path) {
  const html = pageSeoHead(path);
  const tag = '<script type="application/ld+json">';
  const begin = html.indexOf(tag);
  if (begin === -1) return null;
  const from = begin + tag.length;
  return JSON.parse(html.slice(from, html.indexOf("</script>", from)));
}

test("breadcrumb trails reflect the public page hierarchy", () => {
  const schema = crumbs("/teksty/grass-mud-horse-pl/");
  assert.equal(schema["@type"], "BreadcrumbList");
  assert.deepEqual(schema.itemListElement.map(({ position, name, item }) => [position, name, item]), [
    [1, "TRAVNY", "https://travny.pages.dev/"],
    [2, "Teksty", "https://travny.pages.dev/teksty/"],
    [3, "Alpaka, krab i Wielki Harmonizator", "https://travny.pages.dev/teksty/grass-mud-horse-pl/"],
  ]);
});

test("canonicalized route aliases share one trail", () => {
  assert.deepEqual(crumbs("/teksty/token-worldcup/"), crumbs("/teksty/token-worldcup/token-worldcup.html"));
  assert.deepEqual(crumbs("/teksty/grass-mud-horse/index.html"), crumbs("/teksty/grass-mud-horse"));
  assert.equal(pageSeoHead("/"), "");
  assert.equal(pageSeoHead("/does-not-exist"), "");
});

test("effort matrix gets a self canonical and distinct breadcrumb", () => {
  const url = "https://travny.pages.dev/teksty/token-worldcup/effort-matrix.html";
  const tags = pageSeoHead("/teksty/token-worldcup/effort-matrix.html");
  assert.ok(tags.includes(`<link rel="canonical" href="${url}">`));
  assert.ok(tags.includes(`<meta property="og:url" content="${url}">`));
  const schema = crumbs("/teksty/token-worldcup/effort-matrix.html");
  assert.equal(schema.itemListElement.length, 4);
  assert.equal(schema.itemListElement.at(-1).item, url);
  assert.ok(!tags.includes("noindex"));
});
