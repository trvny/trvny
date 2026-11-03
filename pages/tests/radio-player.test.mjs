import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("radio controls follow external pause and play events", async () => {
  class Element {
    constructor() { this.dataset = {}; this.attributes = {}; this.listeners = {}; this.hidden = false; this.textContent = ""; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    dispatch(type) { for (const callback of this.listeners[type] ?? []) callback(); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
  }
  class Audio extends Element {
    constructor() { super(); this.paused = true; this.playCalls = 0; this.sourceChanges = 0; this.setAttribute("src", "https://stream.radioparadise.com/aac-320"); }
    get src() { return this.getAttribute("src"); }
    set src(value) { this.sourceChanges += 1; this.setAttribute("src", value); }
    play() { this.paused = false; this.playCalls += 1; this.dispatch("play"); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatch("pause"); }
    load() { this.loadCalls = (this.loadCalls ?? 0) + 1; }
  }
  class Button extends Element {}
  class Input extends Element { constructor() { super(); this.value = "0.8"; } }
  class Image extends Element {}
  const audio = new Audio();
  const play = new Button();
  const status = new Element();
  const controls = new Element();
  const elements = {
    "[data-audio]": audio, "[data-controls]": controls, "[data-play]": play,
    "[data-volume]": new Input(), "[data-status]": status, "[data-cover]": new Image(),
    "[data-title]": new Element(), "[data-artist]": new Element(), "[data-album]": new Element(),
  };
  const root = new Element();
  root.querySelector = (selector) => elements[selector];
  const document = { hidden: false, listeners: {}, querySelectorAll: () => [root], addEventListener(type, listener) { this.listeners[type] = listener; } };
  const source = await readFile(new URL("../astro/src/components/RadioMini.astro", import.meta.url), "utf8");
  const script = source.split("<script>")[1]?.split("</script>")[0];
  assert.ok(script);
  const pendingMetadata = Promise.race([]);
  runInNewContext(script, {
    document, HTMLAudioElement: Audio, HTMLElement: Element, HTMLButtonElement: Button,
    HTMLInputElement: Input, HTMLImageElement: Image, AbortSignal,
    fetch: () => pendingMetadata, setTimeout, clearTimeout,
  });
  assert.equal(audio.hidden, true);
  assert.equal(controls.hidden, false);
  play.dispatch("click");
  audio.dispatch("playing");
  assert.equal(status.textContent, "Playing live");
  audio.pause();
  assert.equal(status.textContent, "Paused");
  assert.equal(play.getAttribute("aria-label"), "Play Radio Paradise");
  play.dispatch("click");
  assert.equal(audio.playCalls, 2);
  assert.equal(play.getAttribute("aria-label"), "Pause Radio Paradise");
  audio.pause();
  await audio.play();
  assert.equal(status.textContent, "Connecting…");
  assert.equal(play.getAttribute("aria-label"), "Pause Radio Paradise");
  audio.dispatch("error");
  assert.equal(status.textContent, "Stream unavailable. Try again.");
  const changesBeforeRetry = audio.sourceChanges;
  play.dispatch("click");
  assert.equal(audio.sourceChanges, changesBeforeRetry + 1);
  assert.equal(audio.playCalls, 4);
});
