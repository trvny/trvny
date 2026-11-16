import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decorateStaticPage } from "../scripts/prerender-static.mjs";

const site = new URL("../site/", import.meta.url);
test("built static pages retain one navigation and SEO with no runtime injection", async () => {
  const headers = await readFile(new URL("_headers", site), "utf8");
  for (const [file, lang] of [
    ["teksty/githubowa-kraina/index.html", "pl"],
    ["teksty/githubowa-kraina/universe.html", "en"],
    ["teksty/token-worldcup/index.html", "pl"],
    ["teksty/token-worldcup/effort-matrix.html", "pl"],
    ["papagenerator/index.html", "en"],
    ["badges/index.html", "pl"],
  ]) {
    const html = await readFile(new URL(file, site), "utf8");
    assert.equal([...html.matchAll(/id="trvny-nav-toggle"/g)].length, 1, file);
    assert.equal([...html.matchAll(/src="\/assets\/nav.js"/g)].length, 1, file);
    assert.ok(headers.includes("/" + file + "\n  Content-Language: " + lang), file);
    if (!file.startsWith("badges/")) assert.match(html, /"@type":"BreadcrumbList"/);
    if (file.includes("effort-matrix")) assert.match(html, /<meta name="robots" content="noindex,follow">/);
    if (file.includes("token-worldcup/index") || file.includes("papagenerator/index")) {
      assert.match(html, /rel="canonical" href="https:\/\/travny.pages.dev\//);
    }
  }
  assert.ok(headers.includes('</teksty/githubowa-kraina/index.md>; rel="alternate"; type="text/markdown"'));
});

test("static decoration is repeatable without duplicating navigation", () => {
  const page = { path: "/papagenerator/", lang: "en", canonical: true };
  const input = '<!doctype html><html lang="en"><head><title>Test</title></head><body>content</body></html>';
  const rendered = decorateStaticPage(input, page);
  assert.equal(decorateStaticPage(rendered, page), rendered);
  assert.throws(() => decorateStaticPage("<html><head></head></html>", page), /closing body/);
});
