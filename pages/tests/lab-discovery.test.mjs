import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Lab provides visible tool descriptions and a discoverable About page with its privacy policy", async () => {
  const [lab, about, sitemap, brief, full] = await Promise.all([
    "../astro/dist/lab/index.html", "../astro/dist/lab/about/index.html",
    "../site/sitemap.xml", "../site/llms.txt", "../site/llms-full.txt",
  ].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  const url = "https://bartek.lol/lab/about/";
  for (const [id, tool] of [["streambench", "Streambench"], ["codebench", "Codebench"], ["docbench", "Docbench"]]) {
    assert.ok(lab.includes('id="' + id + '"'));
    assert.ok(lab.includes(tool));
    assert.ok([...lab.matchAll(/href="([^"]+)"/g)].some(([, href]) => href === "https://" + id + ".bartek.lol/"));
  }
  assert.match(lab, /Open local M3U\/M3U8 playlists/);
  assert.match(lab, /Scan images from local files or a supported camera/);
  assert.match(lab, /Preview and merge PDFs/);
  assert.ok(lab.includes('href="/lab/about/"'));
  assert.match(about, /<html lang="en">/);
  assert.ok(about.includes('rel="canonical" href="' + url + '"'));
  assert.match(about, /<h1>About the Lab<\/h1>/);
  assert.match(about, /Source and feedback/);
  assert.match(about, /id="privacy">Privacy and data handling/);
  assert.match(about, /Local tools and inputs/);
  assert.match(about, /Network requests/);
  assert.match(about, /Optional agent access/);
  assert.match(about, /processes local documents and PDFs in the browser/);
  assert.match(about, /third-party URLs may receive connection metadata/);
  assert.match(about, /Once returned to an agent or host/);
  assert.ok([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].some(([, loc]) => loc === url));
  assert.ok([...brief.matchAll(/\]\(([^)]+)\)/g)].some(([, href]) => href === url + "#privacy"));
  assert.ok(full.split(/\s+/).some(token => token === url || token === url + "."));
});
