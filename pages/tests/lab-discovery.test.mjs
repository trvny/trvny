import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Lab provides visible tool descriptions and one discoverable privacy policy", async () => {
  const [lab, privacy, sitemap, brief, full] = await Promise.all([
    "../astro/dist/lab/index.html", "../astro/dist/lab/privacy/index.html",
    "../site/sitemap.xml", "../site/llms.txt", "../site/llms-full.txt",
  ].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  const url = "https://bartek.lol/lab/privacy/";
  for (const [id, tool] of [["streambench", "Streambench"], ["codebench", "Codebench"], ["docbench", "Docbench"]]) {
    assert.ok(lab.includes('id="' + id + '"'));
    assert.ok(lab.includes(tool));
    assert.ok([...lab.matchAll(/href="([^"]+)"/g)].some(([, href]) => href === "https://" + id + ".bartek.lol/"));
  }
  assert.match(lab, /Open local M3U\/M3U8 playlists/);
  assert.match(lab, /Scan images from local files or a supported camera/);
  assert.match(lab, /Preview and merge PDFs/);
  assert.ok(lab.includes('href="/lab/privacy/"'));
  assert.match(privacy, /<html lang="en">/);
  assert.ok(privacy.includes('rel="canonical" href="' + url + '"'));
  assert.match(privacy, /Local tools and inputs/);
  assert.match(privacy, /Network requests/);
  assert.match(privacy, /Optional agent access/);
  assert.match(privacy, /processes local documents and PDFs in the browser/);
  assert.match(privacy, /third-party URLs may receive connection metadata/);
  assert.match(privacy, /Once returned to an agent or host/);
  assert.ok([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].some(([, loc]) => loc === url));
  assert.ok([...brief.matchAll(/\]\(([^)]+)\)/g)].some(([, href]) => href === url));
  assert.ok(full.split(/\s+/).some(token => token === url || token === url + "."));
});
