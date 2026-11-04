import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import { miniAppHtmlResponse } from "../src/mini-app-ui.ts";

class FakeElement {
  constructor() {
    this.events = {};
    this.attributes = {};
    this.hidden = false;
    this.textContent = "";
    this.value = "0.8";
    this.children = [];
  }
  addEventListener(name, handler) { this.events[name] = handler; }
  dispatch(name) { this.events[name]?.(); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...children) { this.children = children; }
  scrollIntoView() {}
}

class FakeAudio extends FakeElement {
  constructor() { super(); this.paused = true; this.playCalls = 0; }
  get src() { return this.attributes.src; }
  set src(value) { this.attributes.src = value; }
  play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatch("playing");
    return Promise.resolve();
  }
  pause() { this.paused = true; this.dispatch("pause"); }
  load() {}
}

async function radioHarness(response) {
  const html = await miniAppHtmlResponse().text();
  const start = html.indexOf("<script>") + "<script>".length;
  const source = html.slice(start, html.indexOf("</script>", start));
  const nodes = new Map();
  const requests = [];
  const radioButton = new FakeElement();
  const audio = new FakeAudio();
  nodes.set("radio-audio", audio);
  const document = {
    hidden: false,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new FakeElement());
      return nodes.get(id);
    },
    createElement: () => new FakeElement(),
    querySelector: (selector) => selector === "[data-radio-open]" ? radioButton : null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = { location: { search: "?tab=radio" }, addEventListener() {} };
  const fetch = (url) => {
    requests.push(url);
    return Promise.resolve(response);
  };
  const noop = () => 1;
  new Script(source).runInNewContext({
    document, window, fetch, Date, URLSearchParams, Response,
    setTimeout: noop, clearTimeout: noop,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { nodes, audio, requests, radioButton };
}

test("deep-link opens player and fetches metadata without autoplay", async () => {
  const testTrack = {
    title: "Live Song", artist: "Live Artist", album: "Live Album",
    cover: "https://img.radioparadise.com/covers/m/123.jpg",
    checkedAt: "2026-11-04T19:00:00Z",
  };
  const { nodes, audio, requests, radioButton } = await radioHarness(Response.json(testTrack));
  assert.deepEqual(requests, ["/mini-app/api/radio-now"]);
  assert.equal(nodes.get("radio-player").hidden, false);
  assert.equal(radioButton.attributes["aria-expanded"], "true");
  assert.equal(audio.hidden, true);
  assert.equal(audio.playCalls, 0);
  assert.equal(nodes.get("radio-track-title").textContent, "Live Song");
  assert.equal(nodes.get("radio-artist").textContent, "Live Artist");
  assert.equal(nodes.get("radio-cover").hidden, false);

  nodes.get("radio-toggle").dispatch("click");
  await Promise.resolve();
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.src, "https://stream.radioparadise.com/aac-320");
  assert.equal(nodes.get("radio-status").textContent, "Playing live");
  const volume = nodes.get("radio-volume");
  volume.value = "0.35";
  volume.dispatch("input");
  assert.equal(audio.volume, 0.35);

  nodes.get("radio-toggle").dispatch("click");
  assert.equal(audio.paused, true);
  assert.equal(nodes.get("radio-status").textContent, "Paused");
  assert.equal(audio.attributes.src, undefined);
});

test("missing radio metadata does not block playback", async () => {
  const { nodes, audio } = await radioHarness(new Response("unavailable", { status: 502 }));
  assert.equal(nodes.get("radio-artist").textContent, "Track details unavailable");
  nodes.get("radio-toggle").dispatch("click");
  await Promise.resolve();
  assert.equal(audio.playCalls, 1);
  assert.equal(nodes.get("radio-status").textContent, "Playing live");
});
