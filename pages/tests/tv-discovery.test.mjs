import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

test("TV page scripts parse and use same-origin catalog and freshness endpoints", async () => {
  const html = await readFile(new URL("../site/tv/index.html", import.meta.url), "utf8");
  const start = html.lastIndexOf("<script data-astro-rerun>");
  const end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new Script(html.slice(start + "<script data-astro-rerun>".length, end)));
  assert.match(html, /\/tv\/api\/channels/);
  assert.match(html, /\/tv\/api\/status/);
  assert.match(html, /https:\/\/bartek\.lol\/tv\/playlist\.m3u/);
  assert.doesNotMatch(html, /const CHANNELS = \[/);
  assert.doesNotMatch(html, /data-copy="https:\/\/tvpi\.travny\.workers\.dev\/tvp1\.m3u8"/);
});

test("TV page hydrates channels without AbortSignal.timeout", async () => {
  const html = await readFile(new URL("../site/tv/index.html", import.meta.url), "utf8");
  const start = html.lastIndexOf("<script data-astro-rerun>");
  const end = html.indexOf("</script>", start);
  const body = html.slice(start + "<script data-astro-rerun>".length, end);
  const { runInNewContext } = await import("node:vm");
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", innerHTML: "", className: "", isConnected: true, closest: () => ({ addEventListener() {} }) });
    return nodes.get(id);
  };
  const called = [];
  runInNewContext(body, {
    document: { getElementById: getNode, addEventListener() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    Date, Response, AbortController,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    fetch: async url => {
      called.push(url);
      return Response.json(url === "/tv/api/channels"
        ? { channels: [{ slug: "tvp1", number: "101", name: "TVP 1 HD" },
          { slug: "tvp2", number: "102", name: "TVP 2 HD" }] }
        : { channels: [{ slug: "tvp1", manifest: "fresh" }] });
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(called, ["/tv/api/channels", "/tv/api/status"]);
  const rows = getNode("rows").innerHTML;
  for (const slug of ["tvp1", "tvp2"]) {
    assert.ok(rows.includes(`data-copy="https://bartek.lol/tv/${slug}.m3u8"`));
  }
  const playLinks = [...rows.matchAll(/<a class="play" href="([^"]+)"[^>]*>▶<\/a>/g)].map(([, url]) => url);
  assert.deepEqual(playLinks, [
    "https://streambench.bartek.lol/#tvpi=tvp1",
    "https://streambench.bartek.lol/#tvpi=tvp2",
  ]);
  assert.match(rows, /aria-label="Play TVP 1 HD in Streambench"/);
});

test("TV discovery documents the public API and read-only WebMCP", async () => {
  const files = await Promise.all(["tv/index.md", "llms.txt", "llms-full.txt"].map(path =>
    readFile(new URL("../site/" + path, import.meta.url), "utf8")));
  for (const source of files) {
    assert.match(source, /https:\/\/bartek\.lol\/tv\/api\/channels\b/);
    assert.match(source, /https:\/\/bartek\.lol\/tv\/api\/status\b/);
    assert.match(source, /https:\/\/bartek\.lol\/tv\/playlist\.m3u\b/);
  }
  assert.ok(files[0].includes("get_travny_tv_channels"));
  assert.ok(files[2].includes("get_travny_tv_stream"));
});
