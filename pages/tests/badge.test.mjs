import test from "node:test";
import assert from "node:assert/strict";

import { iconMarkup, matchModel, renderBadge } from "../functions/_shared/badge.js";
import { onRequestGet, resolve } from "../functions/badge/[[path]].js";

const ICON = '<svg fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24"><title>X</title><path d="M0 0h24v24H0z"></path></svg>';

function context(path, query = "") {
  const segments = path.split("/");
  return { request: new Request(`https://travny.pages.dev/badge/${path}${query}`), params: { path: segments } };
}

function fakeFetch(body, ok = true) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return { ok, text: async () => body };
  };
  return { impl, calls };
}

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

test("resolve: brand, model, label override, unknown", () => {
  const q = new URLSearchParams();
  assert.equal(resolve(["cloudflare.svg"], q).label, "Cloudflare");
  const model = resolve(["model", "deepseek", "deepseek-chat.svg"], q);
  assert.equal(model.label, "deepseek-chat");
  assert.equal(model.c1, "#4d6bfe");
  assert.equal(resolve(["mcp.svg"], new URLSearchParams("label=MCP server")).label, "MCP server");
  assert.equal(resolve(["nope.svg"], q), null);
  assert.equal(resolve(["model"], q), null);
});

test("label is escaped and capped", () => {
  const spec = resolve(["mcp.svg"], new URLSearchParams("label=" + encodeURIComponent('<b>"x"&' + "y".repeat(80))));
  assert.equal(spec.label.length, 40);
  const svg = renderBadge({ ...spec, icon: null });
  assert.ok(svg.includes("&lt;b&gt;&quot;x&quot;&amp;"));
  assert.ok(!svg.includes("<b>"));
});

test("XML-invalid label characters are stripped", () => {
  const spec = resolve(["mcp.svg"], new URLSearchParams("label=test%00ba\u001Fdge%EF%BF%BF"));
  assert.equal(spec.label, "testbadge");
  const svg = renderBadge({ label: "a\u0000b\uD800c", c1: "#000", c2: "#000" });
  assert.ok(svg.includes(">abc</text>"));
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(svg));
  assert.equal(resolve(["mcp.svg"], new URLSearchParams("label=%00%01")).label, "MCP");
});

test("icon markup namespaces ids and rejects active content", () => {
  const out = iconMarkup('<svg viewBox="0 0 24 24"><path fill="url(#a)" d="M0 0"/><defs><linearGradient id="a"></linearGradient></defs></svg>', "b", "#111");
  assert.ok(out.includes('id="b-a"') && out.includes("url(#b-a)"));
  assert.equal(iconMarkup('<svg><script>alert(1)</script></svg>', "b", "#111"), null);
  assert.equal(iconMarkup('<svg><path onload="x()"/></svg>', "b", "#111"), null);
  assert.equal(iconMarkup('<svg><image href="https://evil/x.png"/></svg>', "b", "#111"), null);
  assert.ok(iconMarkup(ICON, "b", "#0a7559").includes('fill="#0a7559"'));
});

test("handler serves svg with icon from pinned CDN", async () => {
  const { impl, calls } = fakeFetch(ICON);
  const res = await onRequestGet(context("gpt.svg"), impl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.match(res.headers.get("cache-control"), /s-maxage=86400/);
  assert.match(calls[0], /@lobehub\/icons-static-svg@[\d.]+\/icons\/openai\.svg$/);
  const svg = await res.text();
  assert.ok(svg.includes(">GPT</text>") && svg.includes('fill="#0a7559"'));
});

test("handler degrades without icon and 404s unknown", async () => {
  const down = await onRequestGet(context("model/deepseek/deepseek-chat.svg"), fakeFetch("", false).impl);
  assert.equal(down.status, 200);
  assert.match(down.headers.get("cache-control"), /s-maxage=300/);
  assert.ok((await down.text()).includes("deepseek-chat"));
  const missing = await onRequestGet(context("whatever.svg"), fakeFetch(ICON).impl);
  assert.equal(missing.status, 404);
});
