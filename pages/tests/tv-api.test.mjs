import assert from "node:assert/strict";
import test from "node:test";
import { tvCatalog, tvStatus, tvRoute, buildHubPlaylist } from "../functions/_shared/tv-api.js";
import { onRequest } from "../functions/_middleware.js";

const item = { id: "399697", number: "101", slug: "tvp1", name: "TVP 1 HD",
  group: "Polska", logo: "https://s.tvp.pl/logo.png",
  streamUrl: "https://tvpi.travny.workers.dev/tvp1.m3u8" };
const catalog = { version: 1, channels: [item] };
const service = { fetch: async request => {
  assert.ok(request instanceof Request, "Service binding requires Request");
  assert.equal(request.method, "GET");
  assert.equal(request.headers.get("accept"), "application/json");
  assert.equal(request.redirect, "manual");
  const url = request.url;
  if (url.endsWith("/api/channels")) return Response.json(catalog);
  if (url.endsWith("/api/status")) return Response.json({
    generatedAt: "2026-11-24T00:00:00Z",
    channels: [{ slug: "tvp1", manifest: "fresh", updatedAt: null }],
  });
  throw new Error("bad upstream URL");
} };
function context(pathname, method = "GET") {
  return {
    request: new Request("https://bartek.lol" + pathname, { method }),
    env: { TVPI_SERVICE: service },
    next: async () => new Response("static"),
  };
}

test("TV alias redirects to the stable Worker endpoint, not upstream signed HLS", async () => {
  const res = await onRequest(context("/tv/tvp1.m3u8"));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://tvpi.travny.workers.dev/tvp1.m3u8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const head = await onRequest(context("/tv/tvp1.m3u8", "HEAD"));
  assert.equal(head.status, 302);
  assert.equal(await head.text(), "");
  const post = await onRequest(context("/tv/tvp1.m3u8", "POST"));
  assert.equal(post.status, 405);
});

test("TV metadata uses TVPI catalog and rewrites stable URLs to hub", async () => {
  const data = await tvCatalog(context("/tv/api/channels"));
  assert.equal(data.channels[0].streamUrl, "https://bartek.lol/tv/tvp1.m3u8");
  const response = await onRequest(context("/tv/api/channels"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).channels[0], data.channels[0]);
  const head = await onRequest(context("/tv/api/channels", "HEAD"));
  assert.equal(await head.text(), "");
});

test("Hub playlist uses home-domain links and no short-lived tokens", async () => {
  const res = await onRequest(context("/tv/playlist.m3u"));
  assert.equal(res.headers.get("content-type"), "application/x-mpegurl; charset=utf-8");
  const body = await res.text();
  assert.match(body, /#EXTM3U/);
  assert.match(body, /https:\/\/bartek\.lol\/tv\/tvp1\.m3u8/);
  assert.ok(!body.includes("tvpi.travny.workers.dev"));
  assert.equal((await onRequest(context("/tv/tvp1.m3u"))).status, 200);
  assert.equal((await onRequest(context("/tv/missing.m3u"))).status, 404);
  assert.equal(buildHubPlaylist([]), "#EXTM3U\n");
});

test("Status reports cached manifest freshness, never stream playable", async () => {
  const res = await onRequest(context("/tv/api/status"));
  assert.equal(res.status, 200);
  const status = await res.json();
  assert.equal(status.channels[0].manifest, "fresh");
  assert.match(status.meaning, /not verified/);
  assert.equal((await tvStatus(context("/tv/api/status"))).channels.length, 1);
});

test("TV adapter rejects arbitrary catalog values and fails closed", async () => {
  const bad = { fetch: async () => Response.json({
    channels: [{ ...item, slug: "../push/tvp1" }],
  }) };
  const ctx = context("/tv/api/channels");
  ctx.env.TVPI_SERVICE = bad;
  const res = await tvRoute(ctx, new URL(ctx.request.url));
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "TVPI metadata temporarily unavailable\n");
});

test("public TVPI fallback refuses redirects", async () => {
  const ctx = context("/tv/api/channels");
  ctx.env.TVPI_SERVICE = { fetch: async () => { throw new Error("binding transport"); } };
  let calls = 0;
  let redirectMode = null;
  const fetchImpl = async (_url, init) => {
    calls++;
    redirectMode = init.redirect;
    return new Response(null, {
      status: 302, headers: { Location: "https://example.invalid/redirect" },
    });
  };
  const res = await tvRoute(ctx, new URL(ctx.request.url), fetchImpl);
  assert.equal(res.status, 503);
  assert.equal(calls, 1);
  assert.equal(redirectMode, "manual");
});
