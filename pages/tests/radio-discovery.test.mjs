import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function source(name) {
  return readFile(new URL("../site/" + name, import.meta.url), "utf8");
}

test("TRAVNY Radio has one indexed canonical landing page and linked machine guide", async () => {
  const [html, md, sitemap, home] = await Promise.all([
    source("radio/index.html"), source("radio/index.md"),
    source("sitemap.xml"), readFile(new URL("../astro/src/legacy/home.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /rel="canonical" href="https:\/\/bartek\.lol\/radio\/"/);
  assert.match(html, /name="robots" content="index,follow/);
  assert.match(html, /rel="alternate" type="text\/markdown" href="\/radio\/index\.md"/);
  assert.match(sitemap, /<loc>https:\/\/bartek\.lol\/radio\/<\/loc>/);
  assert.match(home, /id="radio" class="panel radio"/);
  assert.match(home, /data-radio-open href="https:\/\/radio\.bartek\.lol\/" target="_blank" rel="noopener noreferrer" aria-label="Open full player/);
  assert.doesNotMatch(home, /About TRAVNY Radio ↗/);
  assert.match(md, /https:\/\/bartek\.lol\/api\/radio-station\?station=travny/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(jsonLd);
  const graph = JSON.parse(jsonLd[1])["@graph"];
  const service = graph.find(node => node["@type"] === "RadioBroadcastService");
  assert.equal(service["@id"], "https://bartek.lol/radio/#service");
  assert.equal(service.potentialAction.target, "https://radio.bartek.lol/radio.mp3");
  assert.equal(service.isAccessibleForFree, true);
  assert.equal(graph.find(node => node["@type"] === "WebPage").mainEntity["@id"], service["@id"]);
});

test("TRAVNY Radio discovery links to the existing public metadata API without a new backend", async () => {
  const [short, long, md] = await Promise.all([
    source("llms.txt"), source("llms-full.txt"), source("radio/index.md"),
  ]);
  for (const content of [short, long, md]) {
    assert.ok(content.includes("https://bartek.lol/api/radio-station?station=travny"));
    assert.ok(content.includes("get_travny_radio_now"));
  }
  assert.ok(!md.includes("POST /api/"));
});
