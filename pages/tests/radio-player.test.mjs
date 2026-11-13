import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers";

async function player({ deferredPause = false, nativeHls = false } = {}) {
  const pauseEvents = [];
  class Element {
    constructor() { this.dataset = {}; this.attributes = {}; this.listeners = {}; this.hidden = false; this.textContent = ""; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    dispatch(type) { for (const callback of this.listeners[type] ?? []) callback(); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
  }
  class Audio extends Element {
    constructor() { super(); this.paused = true; this.playCalls = 0; }
    get src() { return this.getAttribute("src"); }
    set src(value) { this.setAttribute("src", value); }
    play() { this.paused = false; this.playCalls++; this.dispatch("play"); return Promise.resolve(); }
    pause() {
      if (this.paused) return;
      this.paused = true;
      if (deferredPause) pauseEvents.push(() => this.dispatch("pause"));
      else this.dispatch("pause");
    }
    load() {}
    canPlayType() { return nativeHls ? "maybe" : ""; }
  }
  class Button extends Element {}
  class Input extends Element { constructor() { super(); this.value = "0.8"; } }
  class Image extends Element {}
  class Select extends Element {
    constructor() { super(); this.value = "paradise"; }
    get selectedOptions() { return [this.options[this.value]]; }
  }
  const audio = new Audio();
  const play = new Button();
  const status = new Element();
  const station = new Select();
  station.options = {
    paradise: { textContent: "Radio Paradise", dataset: { url: "paradise.aac", kind: "direct", mark: "RP", quality: "320K AAC" } },
    trojka: { textContent: "Trójka", dataset: { url: "trojka.m3u8", kind: "hls", mark: "3", quality: "LIVE HLS" } },
    bbc1: { textContent: "BBC Radio 1", dataset: { url: "bbc.m3u8", kind: "hls", mark: "1", quality: "320K HLS" } },
  };
  const elements = {
    "[data-audio]": audio, "[data-controls]": new Element(), "[data-play]": play,
    "[data-volume]": new Input(), "[data-status]": status, "[data-cover]": new Image(),
    "[data-title]": new Element(), "[data-artist]": new Element(), "[data-album]": new Element(),
    "[data-station-picker]": new Element(), "[data-station]": station, ".radio-fallback [data-mark]": new Element(),
    "[data-mark-label]": new Element(), ".radio-footer [data-quality]": new Element(),
  };
  const root = new Element();
  root.querySelector = (selector) => elements[selector];
  const document = { hidden: false, querySelectorAll: () => [root], addEventListener() {} };
  const instances = [];
  class Hls {
    static Events = { ERROR: "error", MEDIA_ATTACHED: "attached" };
    static isSupported() { return true; }
    constructor() { instances.push(this); }
    on(event, callback) { if (event === "error") this.onError = callback; else this.onAttached = callback; }
    loadSource(url) { this.url = url; }
    attachMedia(media) { this.media = media; this.onAttached(); }
    stopLoad() { this.stopped = true; }
    startLoad() { this.stopped = false; }
    destroy() { this.destroyed = true; }
  }
  let resolveMetadata;
  const metadata = new Promise((resolve) => { resolveMetadata = resolve; });
  const script = await readFile(new URL("../site/assets/radio.js", import.meta.url), "utf8");
  runInNewContext(script, {
    document, window: { Hls }, HTMLAudioElement: Audio, HTMLElement: Element, HTMLButtonElement: Button,
    HTMLInputElement: Input, HTMLImageElement: Image, HTMLSelectElement: Select, AbortSignal,
    fetch: () => metadata, setTimeout, clearTimeout,
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const select = (value) => { station.value = value; station.dispatch("change"); };
  return { audio, play, status, station, elements, instances, select, flush, resolveMetadata, pauseEvents };
}

test("switching stations stops the old stream and respects pause", async () => {
  const p = await player();
  assert.equal(p.audio.hidden, true);
  assert.equal(p.elements["[data-controls]"].hidden, false);
  assert.equal(p.elements["[data-station-picker]"].hidden, false);
  p.select("trojka");
  await p.flush();
  assert.equal(p.audio.playCalls, 0);
  assert.equal(p.elements["[data-title]"].textContent, "Trójka");
  p.play.dispatch("click");
  await p.flush();
  assert.equal(p.instances[0].url, "trojka.m3u8");
  assert.equal(p.instances[0].media, p.audio);
  p.audio.dispatch("playing");
  assert.equal(p.status.textContent, "Playing live");
  p.select("bbc1");
  assert.equal(p.audio.paused, true);
  p.audio.dispatch("error");
  await p.flush();
  assert.equal(p.instances[0].destroyed, true);
  assert.equal(p.instances[1].url, "bbc.m3u8");
  assert.equal(p.audio.playCalls, 2);
  p.play.dispatch("click");
  assert.equal(p.instances[1].destroyed, true);
  p.select("paradise");
  assert.equal(p.audio.playCalls, 2);
  p.play.dispatch("click");
  assert.equal(p.audio.src, "paradise.aac");
  assert.equal(p.audio.playCalls, 3);
});

test("late Paradise metadata cannot overwrite another station", async () => {
  const p = await player();
  p.select("trojka");
  p.resolveMetadata({ ok: true, json: async () => ({ title: "Old track", artist: "Old artist" }) });
  await p.flush();
  assert.equal(p.elements["[data-title]"].textContent, "Trójka");
  assert.equal(p.elements["[data-artist]"].textContent, "Live radio");
});

test("a pending HLS setup cannot restart after pause", async () => {
  const p = await player();
  p.select("trojka");
  p.play.dispatch("click");
  p.play.dispatch("click");
  await p.flush();
  assert.equal(p.instances.length, 0);
  assert.equal(p.audio.playCalls, 0);
  assert.equal(p.status.textContent, "Paused");
});


test("a queued pause from the old stream cannot cancel a station change", async () => {
  const p = await player({ deferredPause: true });
  p.play.dispatch("click");
  p.select("trojka");
  assert.equal(p.pauseEvents.length, 1);
  p.pauseEvents.shift()();
  await p.flush();
  assert.equal(p.instances[0].url, "trojka.m3u8");
  assert.equal(p.audio.playCalls, 2);
});


test("external pause and resume preserve the source", async () => {
  const p = await player();
  p.select("trojka");
  p.play.dispatch("click");
  await p.flush();
  p.audio.pause();
  assert.equal(p.instances[0].stopped, true);
  assert.equal(p.instances[0].destroyed, undefined);
  await p.audio.play();
  assert.equal(p.instances[0].stopped, false);
  assert.equal(p.status.textContent, "Connecting…");
});

test("discarding a teardown pause does not hide the next external pause", async () => {
  const p = await player({ deferredPause: true });
  p.play.dispatch("click");
  p.select("trojka");
  p.pauseEvents.length = 0;
  await p.flush();
  p.audio.pause();
  p.pauseEvents.shift()();
  assert.equal(p.status.textContent, "Paused");
  assert.equal(p.instances[0].stopped, true);
});


test("native HLS plays directly", async () => {
  const p = await player({ nativeHls: true });
  p.select("trojka");
  p.play.dispatch("click");
  await p.flush();
  assert.equal(p.audio.src, "trojka.m3u8");
  assert.equal(p.instances.length, 0);
});

test("fatal stream errors stop playback and allow retry", async () => {
  const p = await player();
  p.select("trojka");
  p.play.dispatch("click");
  await p.flush();
  p.instances[0].onError("error", { fatal: true });
  assert.equal(p.status.textContent, "Stream unavailable. Try again.");
  p.play.dispatch("click");
  await p.flush();
  assert.equal(p.instances.length, 2);
  p.audio.error = { code: 2 };
  p.audio.dispatch("error");
  assert.equal(p.status.textContent, "Stream unavailable. Try again.");
});
