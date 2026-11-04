import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/radio-now.js";

test("radio metadata exposes a bounded, safe track from the main mix", async (t) => {
  let requested = "";
  t.mock.method(globalThis, "fetch", (url) => {
    requested = url;
    return Promise.resolve(Response.json({ title: " Song ", artist: " Artist ", album: "Album", cover_med: "https://img.radioparadise.com/covers/m/123.jpg" }));
  });
  const response = await onRequestGet();
  assert.equal(requested, "https://api.radioparadise.com/api/now_playing?chan=0");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://tg-assistant.travny.workers.dev");
  assert.match(response.headers.get("cache-control"), /s-maxage=20/);
  assert.deepEqual(await response.json(), { title: "Song", artist: "Artist", album: "Album", cover: "https://img.radioparadise.com/covers/m/123.jpg" });
});

test("radio metadata rejects untrusted artwork and oversized text", async (t) => {
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ title: "x".repeat(250), artist: "Artist", cover: "https://img.radioparadise.com.evil.test/covers/a.jpg" })));
  const data = await (await onRequestGet()).json();
  assert.equal(data.title.length, 200);
  assert.equal(data.cover, "");
});

test("radio metadata failures stay uncached and never block playback", async (t) => {
  for (const response of [
    new Response("down", { status: 503 }),
    Response.json({ title: "", artist: "" }),
    new Response("x".repeat(32769)),
  ]) {
    const fetchMock = t.mock.method(globalThis, "fetch", () => Promise.resolve(response));
    const result = await onRequestGet();
    assert.equal(result.status, 502);
    assert.equal(result.headers.get("access-control-allow-origin"), "https://tg-assistant.travny.workers.dev");
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { error: "metadata_unavailable" });
    fetchMock.mock.restore();
  }
});
