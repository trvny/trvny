import test from "node:test";
import assert from "node:assert/strict";
import { serviceFetch } from "../functions/_shared/service-fetch.js";

const weather = "https://weather.travny.workers.dev/state.json";
const reactor = "https://shitpost-reactor.travny.workers.dev/feed.json";
const context = env => ({ request: new Request("https://travny.pages.dev/"), env });

test("direct bindings receive only their configured public endpoint", async () => {
  const calls = [];
  const publicFetch = async (url, init) => { calls.push(["public", url]); assert.ok(init.cf); if (url === weather) assert.equal(init.method, "POST"); return Response.json({ public: true }); };
  const env = {
    WEATHER_SERVICE: { fetch: async (url, init) => { calls.push(["weather", url]); assert.equal(init.cf, undefined); return Response.json({ direct: true }); } },
    REACTOR_SERVICE: { fetch: async url => { calls.push(["reactor", url]); return Response.json({ direct: true }); } },
  };
  assert.deepEqual(await (await serviceFetch(context(env), "WEATHER_SERVICE", publicFetch)(weather, { cf: { cacheTtl: 300 } })).json(), { direct: true });
  assert.deepEqual(await (await serviceFetch(context(env), "REACTOR_SERVICE", publicFetch)(reactor)).json(), { direct: true });
  await serviceFetch(context(env), "WEATHER_SERVICE", publicFetch)(reactor, { cf: { cacheTtl: 300 } });
  await serviceFetch(context(env), "WEATHER_SERVICE", publicFetch)(weather, { method: "POST", cf: { cacheTtl: 300 } });
  assert.deepEqual(calls, [["weather", weather], ["reactor", reactor], ["public", reactor], ["public", weather]]);
});

test("missing or throwing bindings fall back; HTTP errors and aborted calls do not retry", async () => {
  let calls = 0;
  const publicFetch = async () => { calls++; return Response.json({}); };
  await serviceFetch(context({}), "WEATHER_SERVICE", publicFetch)(weather);
  const env = { WEATHER_SERVICE: { fetch: async () => { throw new Error("unavailable"); } } };
  await serviceFetch(context(env), "WEATHER_SERVICE", publicFetch)(weather);
  await assert.rejects(serviceFetch(context(env), "WEATHER_SERVICE", publicFetch)(weather, { signal: AbortSignal.abort() }));
  env.WEATHER_SERVICE.fetch = async () => new Response("unavailable", { status: 503 });
  assert.equal((await serviceFetch(context(env), "WEATHER_SERVICE", publicFetch)(weather)).status, 503);
  assert.equal(calls, 2);
});

test("public successful reads share a 5-minute cache across hub pages", async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const cached = new Map();
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { open: async () => ({
    match: async key => cached.get(key.url)?.clone(),
    put: async (key, response) => { cached.set(key.url, response); },
  }) } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else delete globalThis.caches;
  });
  let calls = 0;
  const env = { WEATHER_SERVICE: { fetch: async () => { calls++; return new Response("unavailable", { status: 503 }); } } };
  const ctx = context(env);
  const fetchWeather = serviceFetch(ctx, "WEATHER_SERVICE");
  assert.equal((await fetchWeather(weather)).status, 503);
  assert.equal(cached.size, 0);
  env.WEATHER_SERVICE.fetch = async () => { calls++; return Response.json({ state: "ok" }); };
  assert.deepEqual(await (await fetchWeather(weather)).json(), { state: "ok" });
  ctx.request = new Request("https://preview.travny.pages.dev/weather?utm_source=test");
  assert.deepEqual([...cached.keys()], ["https://travny.pages.dev/__hub-cache/WEATHER_SERVICE"]);
  const hit = await fetchWeather(weather);
  assert.equal(hit.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await hit.json(), { state: "ok" });
  assert.equal(calls, 2);
  const stale = cached.values().next().value;
  stale.headers.set("x-travny-cached-at", String(Date.now() - 301000));
  env.WEATHER_SERVICE.fetch = async () => { calls++; return Response.json({ state: "fresh" }); };
  assert.deepEqual(await (await fetchWeather(weather)).json(), { state: "fresh" });
  assert.equal(calls, 3);
  assert.deepEqual(await (await fetchWeather(weather)).json(), { state: "fresh" });
  assert.equal(calls, 3);
});
