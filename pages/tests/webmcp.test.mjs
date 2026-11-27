import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("hub exposes navigation and read-only discovery tools", async () => {
  const source = await readFile(new URL("../site/assets/webmcp.js", import.meta.url), "utf8");
  const tools = new Map();
  const window = new EventTarget();
  const assigned = [];
  const link = { textContent: "Feedseek", href: "https://trvny.github.io/feedseek/" };
  const links = [link];
  window.location = { assign: url => assigned.push(url) };
  const radioCalls = [];
  runInNewContext(source, {
    fetch: async (url, options) => {
      if (url === "/tv/api/channels") return Response.json({
        version: 1, playlistUrl: "https://bartek.lol/tv/playlist.m3u",
        channels: [{ number: "101", slug: "tvp1", name: "TVP 1 HD",
          streamUrl: "https://bartek.lol/tv/tvp1.m3u8" }],
      });
      if (url === "/teksty/githubowa-kraina/atlas.json") return Response.json({
        regions: [{ id: "workshop", name: "Workshop", description: "Tools", url: "https://github.com/travnie/twojstar",
          items: [{ name: "Audacity", description: "Audio restoration", url: "https://github.com/travnie/twojstar/tree/main/addons/audacity",
            translations: { pl: { name: "Wtyczki", description: "Naprawa dźwięku" } } }] }],
      });
      radioCalls.push({ url, options });
      return Response.json({
        kind: "track", title: "Current Mix", artist: "DJ", album: "Album",
        cover: "https://travny-radio.taild44c6c.ts.net/artwork/0123456789abcdefabcd.jpg",
      });
    },
    AbortSignal, Response,
    document: {
      modelContext: { registerTool: (tool, options) => tools.set(tool.name, { tool, options }) },
      querySelectorAll: selector => selector === ".trvny-nav-link[href]" ? links : [],
    }, window, AbortController, console,
  });
  assert.equal(tools.size, 8);
  const list = tools.get("list_travny_destinations");
  assert.equal(list.tool.annotations.readOnlyHint, true);
  assert.equal(list.tool.execute({ query: "feed" }).destinations.length, 1);
  assert.equal(list.tool.execute({ query: "missing" }).destinations.length, 0);
  assert.equal(list.tool.execute({ query: 123 }).ok, false);
  assert.equal(list.tool.execute(null).ok, false);
  link.textContent = "Feedy";
  assert.equal(list.tool.execute({ query: "feedy" }).destinations[0].label, "Feedy");
  assert.equal(assigned.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(tools.get("get_travny_agent_resources").tool.execute().resources)), [
    { name: "Concise guide", url: "https://bartek.lol/llms.txt" },
    { name: "Full guide", url: "https://bartek.lol/llms-full.txt" },
    { name: "TVPI catalog", url: "https://bartek.lol/tv/api/channels" },
    { name: "TVPI playlist", url: "https://bartek.lol/tv/playlist.m3u" },
    { name: "TRAVNY Radio guide", url: "https://bartek.lol/radio/index.md" },
    { name: "TRAVNY Radio now playing", url: "https://bartek.lol/api/radio-station?station=travny" },
    { name: "Publications", url: "https://bartek.lol/teksty/feed.xml" },
    { name: "Project atlas", url: "https://bartek.lol/teksty/githubowa-kraina/atlas.json" },
    { name: "Infrastructure snapshot", url: "https://bartek.lol/teksty/githubowa-kraina/infrastructure.json" },
    { name: "Sitemap", url: "https://bartek.lol/sitemap.xml" },
  ]);
  const search = tools.get("search_travny_projects").tool;
  assert.equal(search.annotations.readOnlyHint, true);
  assert.equal((await search.execute()).regions.length, 1);
  assert.equal((await search.execute({ query: "dźwięku", region: "workshop" })).regions[0].items[0].name, "Audacity");
  assert.equal((await search.execute({ query: "missing" })).regions.length, 0);
  assert.equal((await search.execute({ region: "missing" })).regions.length, 0);
  assert.equal((await search.execute({ query: 123 })).ok, false);
  assert.equal((await search.execute({ url: "https://example.com" })).ok, false);
  const tvList = tools.get("get_travny_tv_channels").tool;
  assert.equal(tvList.annotations.readOnlyHint, true);
  const tvResult = await tvList.execute();
  assert.equal(tvResult.ok, true);
  assert.equal(tvResult.channels[0].streamUrl, "https://bartek.lol/tv/tvp1.m3u8");
  assert.equal((await tvList.execute({ slug: "tvp1" })).ok, false);
  const tvTool = tools.get("get_travny_tv_stream").tool;
  assert.equal(tvTool.annotations.readOnlyHint, true);
  const individual = await tvTool.execute({ slug: "tvp1" });
  assert.equal(individual.name, "TVP 1 HD");
  assert.equal(individual.playlistUrl, "https://bartek.lol/tv/tvp1.m3u");
  assert.equal((await tvTool.execute({ slug: "missing" })).ok, false);
  assert.equal((await tvTool.execute({ slug: "../push" })).ok, false);
  const nowTool = tools.get("get_travny_radio_now").tool;
  assert.equal(nowTool.annotations.readOnlyHint, true);
  const track = await nowTool.execute();
  assert.equal(track.ok, true);
  assert.equal(track.now.title, "Current Mix");
  assert.equal(track.now.artist, "DJ");
  assert.equal(track.now.album, "Album");
  assert.equal(track.now.cover, "https://travny-radio.taild44c6c.ts.net/artwork/0123456789abcdefabcd.jpg");
  assert.equal(track.streamUrl, "https://radio.bartek.lol/radio.mp3");
  assert.equal(radioCalls.length, 1);
  assert.equal(radioCalls[0].url, "/api/radio-station?station=travny");
  assert.equal(radioCalls[0].options.cache, "no-store");
  assert.equal((await nowTool.execute({ station: "unknown" })).ok, false);
  assert.equal(radioCalls.length, 1);
  assert.equal(tools.get("open_travny_destination").tool.execute({ destination: "unknown" }).ok, false);
  assert.equal(tools.get("open_travny_destination").tool.execute({ destination: "Feedy" }).ok, true);
  assert.equal(assigned[0], "https://trvny.github.io/feedseek/");
  links.length = 0;
  tools.clear();
  runInNewContext(source, {
    document: { querySelectorAll: () => [] },
    navigator: { modelContext: { registerTool: (tool, options) => tools.set(tool.name, { tool, options }) } },
    window: new EventTarget(), AbortController, console,
  });
  assert.equal(tools.size, 8);
  assert.equal(tools.get("list_travny_destinations").tool.execute().destinations.length, 0);
  assert.equal(tools.get("get_travny_agent_resources").tool.execute().resources.length, 10);
  const cached = new Event("pagehide");
  cached.persisted = true;
  window.dispatchEvent(cached);
  assert.equal(list.options.signal.aborted, false);
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(list.options.signal.aborted, true);
});

test("atlas search finds advertised multi-word queries against the real catalog", async () => {
  const source = await readFile(new URL("../site/assets/webmcp.js", import.meta.url), "utf8");
  const atlas = JSON.parse(await readFile(new URL("../site/teksty/githubowa-kraina/atlas.json", import.meta.url), "utf8"));
  const tools = new Map();
  runInNewContext(source, {
    fetch: async url => {
      assert.equal(url, "/teksty/githubowa-kraina/atlas.json");
      return Response.json(atlas);
    },
    document: {
      modelContext: { registerTool: tool => tools.set(tool.name, tool) },
      querySelectorAll: () => [],
    },
    window: new EventTarget(), AbortController, AbortSignal, console,
  });
  const search = tools.get("search_travny_projects");
  const names = async query => {
    const result = await search.execute({ query, region: "workshop" });
    assert.equal(result.ok, true);
    return Array.from(result.regions.flatMap(region => region.items.map(item => item.name)));
  };
  assert.deepEqual(await names("SpaceMolt tools"), ["SpaceMolt / SMX"]);
  assert.deepEqual(await names("desktop pets"), ["GPTomek pet", "Loopling pet"]);
  assert.deepEqual(await names("  TOOLS   spacemolt  "), ["SpaceMolt / SMX"]);
  assert.deepEqual(await names("SpaceMolt missing"), []);
});

test("infrastructure connections use the public map snapshot and fixed URL", async () => {
  const source = await readFile(new URL("../site/assets/webmcp.js", import.meta.url), "utf8");
  const graph = JSON.parse(await readFile(new URL("../site/teksty/githubowa-kraina/infrastructure.json", import.meta.url), "utf8"));
  const tools = new Map();
  const requests = [];
  runInNewContext(source, {
    fetch: async url => { requests.push(url); return Response.json(graph); },
    document: { modelContext: { registerTool: tool => tools.set(tool.name, tool) } },
    window: new EventTarget(), AbortController, AbortSignal, console,
  });
  const tool = tools.get("get_travny_infrastructure_connections");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal((await tool.execute({ id: "https://example.com" })).ok, false);
  assert.equal((await tool.execute({ id: "pages", url: "https://example.com" })).ok, false);
  assert.equal(requests.length, 0);
  const info = await tool.execute({ id: "pages" });
  assert.equal(info.ok, true);
  assert.equal(info.node.id, "pages");
  assert.equal(info.snapshot, graph.snapshot);
  assert.equal(info.mapUrl, "https://bartek.lol/teksty/githubowa-kraina/universe#pages");
  assert.ok(info.connections.some(({ kind, direction, node }) => kind === "source" && direction === "incoming" && node.id === "repo-hub"));
  assert.ok(info.connections.some(({ direction }) => direction === "outgoing"));
  assert.deepEqual(requests, ["/teksty/githubowa-kraina/infrastructure.json"]);
  assert.equal((await tool.execute({ id: "unknown-node" })).error, "Unknown infrastructure node.");
});
