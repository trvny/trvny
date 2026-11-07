import test from "node:test";
import assert from "node:assert/strict";

import { iconMarkup, matchModel, renderBadge } from "../functions/_shared/badge.js";
import { ECO, MARKS, paletteColour } from "../functions/_shared/eco.js";
import { catalogue, onRequestGet, resolve } from "../functions/badge/[[path]].js";

const ICON = '<svg fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24"><title>X</title><path d="M0 0h24v24H0z"></path></svg>';
const OCTICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M1 1h22v22H1z"></path></svg>';

function context(path, query = "") {
  return { request: new Request(`https://travny.pages.dev/badge/${path}${query}`), params: { path: path.split("/") } };
}

// url -> body; unknown urls 404.
function router(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [match, body] of routes) {
      if (url.includes(match)) {
        if (body instanceof Error) throw body;
        return new Response(body, { status: 200 });
      }
    }
    return new Response("nope", { status: 404 });
  };
  return { impl, calls };
}

const q = (s = "") => new URLSearchParams(s);

test("model ids map like upstream ModelIcon (first match wins)", () => {
  assert.equal(matchModel("deepseek/deepseek-chat").icon, "deepseek");
  assert.equal(matchModel("anthropic/claude-sonnet-4.5").icon, "claude");
  assert.equal(matchModel("openai/gpt-5-mini").icon, "openai");
  assert.equal(matchModel("glm-4.6").icon, "zai");
  assert.equal(matchModel("glm-4.5v").icon, "glmv");
  assert.equal(matchModel("google/gemini-2.5-flash").icon, "gemini");
  assert.equal(matchModel("moonshotai/kimi-k2").icon, "moonshot");
  assert.equal(matchModel("qwen/qwen3-coder").icon, "qwen");
  assert.equal(matchModel("totally-unknown-model"), null);
});

test("resolve: brand, eco, model, octicon, counter, status, mark, unknown", () => {
  assert.equal(resolve(["cloudflare.svg"], q()).spec.label, "Cloudflare");
  assert.equal(resolve(["kanarek.svg"], q()).spec.src, "inline");
  const model = resolve(["model", "deepseek", "deepseek-chat.svg"], q()).spec;
  assert.equal(model.label, "deepseek-chat");
  assert.equal(model.c1, "#4d6bfe");
  const oct = resolve(["o", "git-merge-queue.svg"], q("label=queue&color=green&value=3")).spec;
  assert.deepEqual([oct.icon, oct.label, oct.c1, oct.value], ["git-merge-queue", "queue", "#2da44e", "3"]);
  assert.equal(resolve(["feedseek", "feeds.svg"], q()).kind, "counter");
  assert.equal(resolve(["status", "kanarek.svg"], q()).kind, "status");
  assert.equal(resolve(["mark", "twojstar.svg"], q("size=9999")).size, 512);
  assert.equal(resolve(["mcp.svg"], q("label=MCP server")).spec.label, "MCP server");
  assert.equal(resolve(["nope.svg"], q()), null);
  assert.equal(resolve(["model"], q()), null);
  assert.equal(resolve(["o", "../etc.svg"], q()), null);
  assert.equal(resolve(["status", "evil.svg"], q()), null);
});

test("palette accepts names and hex only", () => {
  assert.deepEqual(paletteColour("gold"), ["#e0b84c", "#a8801f"]);
  assert.equal(paletteColour("#ff0000")[0], "#ff0000");
  assert.equal(paletteColour("ff0000")[1], "#8c0000");
  assert.equal(paletteColour("red;stroke:x"), null);
  assert.equal(paletteColour("url(#x)"), null);
});

test("label and value are escaped and capped", () => {
  const spec = resolve(["mcp.svg"], q("label=" + encodeURIComponent('<b>"x"&' + "y".repeat(80)) + "&value=%3Ci%3E")).spec;
  assert.equal(spec.label.length, 40);
  const svg = renderBadge({ ...spec, icon: null });
  assert.ok(svg.includes("&lt;b&gt;&quot;x&quot;&amp;"));
  assert.ok(svg.includes(">&lt;i&gt;</text>"));
  assert.ok(!svg.includes("<b>") && !svg.includes("<i>"));
});

test("XML-invalid label characters are stripped", () => {
  assert.equal(resolve(["mcp.svg"], q("label=test%00ba\u001Fdge%EF%BF%BF")).spec.label, "testbadge");
  const svg = renderBadge({ label: "a\u0000b\uD800c", c1: "#000", c2: "#000" });
  assert.ok(svg.includes(">abc</text>"));
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(svg));
  assert.equal(resolve(["mcp.svg"], q("label=%00%01")).spec.label, "MCP");
});

test("icon markup namespaces ids and rejects active content", () => {
  const out = iconMarkup('<svg viewBox="0 0 24 24"><path fill="url(#a)" d="M0 0"/><defs><linearGradient id="a"></linearGradient></defs></svg>', "b", "#111");
  assert.ok(out.includes('id="b-a"') && out.includes("url(#b-a)"));
  assert.equal(iconMarkup("<svg><script>alert(1)</script></svg>", "b", "#111"), null);
  assert.equal(iconMarkup('<svg><path onload="x()"/></svg>', "b", "#111"), null);
  assert.equal(iconMarkup('<svg><image href="https://evil/x.png"/></svg>', "b", "#111"), null);
  assert.equal(iconMarkup("<svg><style>*{}</style></svg>", "b", "#111"), null);
  assert.ok(iconMarkup(ICON, "b", "#0a7559").includes('fill="#0a7559"'));
  assert.ok(iconMarkup(OCTICON, "b", "#e8590c", { fill: true }).includes('fill="#e8590c"'));
});

test("inline marks and eco rows are well-formed", () => {
  for (const [slug, row] of Object.entries(ECO)) {
    assert.match(row.c1, /^#[0-9a-f]{6}$/, slug);
    if (row.src === "inline") assert.ok(MARKS[row.icon], slug);
  }
  for (const body of Object.values(MARKS)) assert.ok(!/<script|\son\w+=|href=/i.test(body));
});

test("brand badge loads lobe icon from pinned CDN", async () => {
  const { impl, calls } = router([["icons-static-svg", ICON]]);
  const res = await onRequestGet(context("gpt.svg"), impl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.match(res.headers.get("cache-control"), /s-maxage=86400/);
  assert.match(calls[0], /@lobehub\/icons-static-svg@[\d.]+\/icons\/openai\.svg$/);
  const svg = await res.text();
  assert.ok(svg.includes(">GPT</text>") && svg.includes('fill="#0a7559"'));
});

test("octicon badge fetches pinned octicons and fills them", async () => {
  const { impl, calls } = router([["@primer/octicons", OCTICON]]);
  const res = await onRequestGet(context("o/rocket.svg", "?label=launch&color=purple&value=v2"), impl);
  assert.match(calls[0], /@primer\/octicons@[\d.]+\/build\/svg\/rocket-24\.svg$/);
  const svg = await res.text();
  assert.ok(svg.includes('fill="#8250df"') && svg.includes(">launch</text>") && svg.includes(">v2</text>"));
});

test("16px-only octicons fall back and keep their viewBox", async () => {
  const small = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M1 1h14v14H1z"></path></svg>';
  const { impl, calls } = router([["git-pull-request-agent-16", small]]);
  const svg = await (await onRequestGet(context("o/git-pull-request-agent.svg"), impl)).text();
  assert.equal(calls.length, 2);
  assert.ok(svg.includes('viewBox="0 0 16 16"') && svg.includes("M1 1h14v14H1z"));
});

test("inline mark needs no fetch; /mark renders bare square svg", async () => {
  const { impl, calls } = router([]);
  const badge = await (await onRequestGet(context("twojstar.svg"), impl)).text();
  assert.ok(badge.includes("#d4a83a") && badge.includes(">twojstar</text>"));
  const res = await onRequestGet(context("mark/papiesz.svg", "?size=128"), impl);
  const mark = await res.text();
  assert.equal(res.status, 200);
  assert.match(mark, /^<svg [^>]*width="128" height="128" viewBox="0 0 24 24"/);
  assert.equal(calls.length, 0);
});

test("counters read live sources and degrade to n/a", async () => {
  const page = '<b id="shown">3</b> / 3 feeds' + '<li data-search="a"></li>'.repeat(3);
  const { impl } = router([["@primer/octicons", OCTICON], ["feedseek", page]]);
  const res = await onRequestGet(context("feedseek/feeds.svg"), impl);
  assert.ok((await res.text()).includes(">3 feeds</text>"));
  assert.match(res.headers.get("cache-control"), /s-maxage=3600/);

  const tv = router([["tvpi", "#EXTM3U\n#EXTINF:-1,A\nu\n#EXTINF:-1,B\nu\n"]]);
  assert.ok((await (await onRequestGet(context("tvpi/channels.svg"), tv.impl)).text()).includes(">2 channels</text>"));

  const down = router([["tvpi", new Error("boom")]]);
  const bad = await onRequestGet(context("tvpi/channels.svg"), down.impl);
  assert.ok((await bad.text()).includes(">n/a</text>"));
  assert.match(bad.headers.get("cache-control"), /s-maxage=300/);
});

test("status badge shows up/down", async () => {
  const up = await (await onRequestGet(context("status/kanarek.svg"), router([["kanarek", '{"ok":true}']]).impl)).text();
  assert.ok(up.includes(">up</text>") && up.includes("#1a7f37"));
  const down = await (await onRequestGet(context("status/kanarek.svg"), router([["kanarek", '{"ok":false}']]).impl)).text();
  assert.ok(down.includes(">down</text>"));
  const broken = await (await onRequestGet(context("status/kanarek.svg"), router([["kanarek", "<html>"]]).impl)).text();
  assert.ok(broken.includes(">down</text>"));
});

test("index.json lists every group; unknown is 404", async () => {
  const res = await onRequestGet(context("index.json"), router([]).impl);
  const data = await res.json();
  assert.deepEqual(data, catalogue());
  const groups = new Set(data.badges.map((b) => b.group));
  for (const g of ["Brand", "Apps", "Workshop", "Bots", "Reviewers", "Live", "AI & infra"]) assert.ok(groups.has(g), g);
  assert.equal((await onRequestGet(context("whatever.svg"), router([]).impl)).status, 404);
});
