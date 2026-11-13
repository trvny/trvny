import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const home = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const rail = await readFile(new URL("../site/assets/rails.js", import.meta.url), "utf8");
const bench = await readFile(new URL("../astro/dist/lab/index.html", import.meta.url), "utf8");
const lab = await readFile(new URL("../astro/src/pages/lab/index.astro", import.meta.url), "utf8");

test("mobile rails retain direct card links and accessible slide controls", () => {
  assert.match(home, /class="feature-rail" id="featureRail"/);
  assert.match(bench, /class="benchgrid" id="benchRail"/);
  assert.equal([...home.matchAll(/class="panel (?:tv|wx)"/g)].length, 2);
  for (const [name, host] of [['stream', 'streambench'], ['code', 'codebench'], ['doc', 'docbench']]) {
    assert.ok(bench.includes(`<a class="bench ${name}" href="https://${host}.travny.workers.dev/"`));
  }
  assert.equal([...home.matchAll(/data-slide="[012]" aria-label=/g)].length, 3);
  assert.equal([...bench.matchAll(/data-slide="[012]" aria-label=/g)].length, 3);
  assert.match(home, /scroll-snap-type:x mandatory/);
  assert.match(home, /prefers-reduced-motion:reduce/);
  assert.match(rail, /pauseUntil=Date\.now\(\)\+delay\*2/);
});

test("Feedseek uses its existing XML media and icons with lazy image fallback", () => {
  assert.match(home, /getElementsByTagNameNS\(ns,"thumbnail"\)/);
  assert.match(home, /feed > icon, channel > image > url/);
  assert.match(home, /img\.loading="lazy"/);
  assert.match(home, /img\.referrerPolicy="no-referrer"/);
  assert.match(home, /img\.onerror=/);
  assert.ok(!home.includes('FBASE+f.file+".json"'));
});

test("home inline script remains parseable", () => {
  const marker = "<script>";
  const begin = home.lastIndexOf(marker);
  const end = home.indexOf("</script>", begin);
  assert.ok(begin >= 0 && end > begin);
  assert.doesNotThrow(() => new Script(home.slice(begin + marker.length, end)));
});

test("Weather is the default mobile feature and auto-rotation resumes after interaction", () => {
  assert.ok(home.indexOf('class="panel wx"') < home.indexOf('class="panel tv"'));
  assert.match(home, /@media \(min-width:641px\)\{\.feature-rail>\.panel\.tv\{order:-1\}/);
  assert.match(home, /data-slide="0" aria-label="Weather" aria-pressed="true"/);
  assert.match(home, /data-slide="1" aria-label="TV status" aria-pressed="false"/);
  assert.match(home, /data-slide="2" aria-label="Radio" aria-pressed="false"/);
  assert.ok(home.indexOf("data-radio aria-labelledby") < home.indexOf('id="featureDots"'));

  const events = {};
  const dots = Array.from({ length: 3 }, () => ({
    state: null,
    setAttribute(name, value) {
      if (name === "aria-pressed") this.state = value;
    },
    addEventListener(name, callback) { this[name] = callback; },
  }));
  const track = {
    children: [{ offsetLeft: 0 }, { offsetLeft: 360 }, { offsetLeft: 720 }],
    scrollLeft: 0, scrollWidth: 1080, clientWidth: 360,
    contains(node) { return this.children.includes(node); },
    addEventListener(name, callback) { events[name] = callback; },
    scrollTo({ left }) { this.scrollLeft = left; },
  };
  const toggle = { hidden: true, textContent: "Pause", setAttribute(name, value) { this[name] = value; },
    addEventListener(name, callback) { this[name] = callback; } };
  const nav = { querySelectorAll: () => dots, querySelector: () => toggle, contains: (node) => dots.includes(node) };
  let clock = 0;
  let cycle = null;
  const context = {
    window: {},
    document: {
      hidden: false,
      getElementById: (id) => ({ featureRail: track, featureDots: nav })[id],
    },
    Date: { now: () => clock },
    matchMedia: (query) => ({ matches: query.includes("max-width") }),
    setInterval: (callback, delay) => {
      assert.equal(delay, 10_000);
      cycle = callback;
    },
    requestAnimationFrame: (callback) => callback(),
  };
  new Script(rail).runInNewContext(context);
  assert.equal(dots[0].state, null);
  cycle();
  assert.equal(track.scrollLeft, 360);
  assert.equal(dots[1].state, "true");
  assert.equal(toggle.hidden, false);
  toggle.click();
  cycle();
  assert.equal(track.scrollLeft, 360, "paused rail must not rotate");
  assert.equal(toggle.textContent, "Resume");
  toggle.click();
  assert.equal(toggle.textContent, "Pause");

  clock = 1_000;
  events.pointerdown();
  cycle();
  assert.equal(track.scrollLeft, 360);
  clock = 22_000;
  cycle();
  assert.equal(track.scrollLeft, 720);
  cycle();
  assert.equal(track.scrollLeft, 0);
  assert.equal(dots[0].state, "true");

  context.document.activeElement = track.children[0];
  cycle();
  assert.equal(track.scrollLeft, 0, "focused link must stay visible");
  context.document.activeElement = dots[0];
  cycle();
  assert.equal(track.scrollLeft, 0, "focused selector must stay on the selected slide");
  context.document.activeElement = null;

  clock = 50_000;
  context.document.hidden = true;
  cycle();
  assert.equal(track.scrollLeft, 0, "hidden tab must not rotate");
  context.document.hidden = false;

  context.matchMedia = (query) => ({ matches: query.includes("max-width") || query.includes("reduced-motion") });
  context.setupRail("featureRail", "featureDots", 10_000);
  cycle();
  assert.equal(track.scrollLeft, 0, "reduced motion must not rotate");

  context.matchMedia = (query) => ({ matches: query.includes("max-width") });
  let onVisibility;
  context.window.IntersectionObserver = class {
    constructor(callback) { onVisibility = callback; }
    observe() {}
  };
  context.IntersectionObserver = context.window.IntersectionObserver;
  context.setupRail("featureRail", "featureDots", 10_000);
  cycle();
  assert.equal(track.scrollLeft, 0, "offscreen rail must not rotate");
  onVisibility([{ isIntersecting: true, intersectionRatio: 0.5 }]);
  cycle();
  assert.equal(track.scrollLeft, 360, "visible rail resumes rotating");

  track.scrollLeft = 720;
  const target = { closest: () => null };
  events.touchstart({ touches: [{ clientX: 280, clientY: 50 }], target });
  events.touchend({ changedTouches: [{ clientX: 120, clientY: 55 }] });
  assert.equal(track.scrollLeft, 0, "forward swipe wraps from radio to weather");
  events.touchstart({ touches: [{ clientX: 100, clientY: 50 }], target });
  events.touchend({ changedTouches: [{ clientX: 260, clientY: 55 }] });
  assert.equal(track.scrollLeft, 720, "backward swipe wraps from weather to radio");
  track.scrollLeft = 600;
  events.touchstart({ touches: [{ clientX: 280, clientY: 50 }], target });
  events.touchend({ changedTouches: [{ clientX: 120, clientY: 55 }] });
  assert.equal(track.scrollLeft, 600, "a swipe before the end does not wrap");
  track.scrollLeft = 720;
  events.touchstart({ touches: [{ clientX: 280, clientY: 50 }], target: { closest: selector => selector.split(", ").includes("input") ? {} : null } });
  events.touchend({ changedTouches: [{ clientX: 120, clientY: 55 }] });
  assert.equal(track.scrollLeft, 720, "radio controls do not trigger swipe wrapping");
  track.children[2].matches = selector => selector.includes('data-playing="true"');
  cycle();
  assert.equal(track.scrollLeft, 720, "playing radio stops automatic rotation");
  track.children[2].matches = () => false;
  clock += 30_000;
  cycle();
  assert.equal(track.scrollLeft, 0, "rotation resumes after playback stops");
});

test("home hosts radio and Lab hosts the shared workbench rail", () => {
  assert.match(home, /data-radio aria-labelledby="radio-heading"/);
  assert.match(home, /src="\/assets\/radio\.js"/);
  assert.ok(!home.includes('id="benchRail"'));
  assert.match(home, /href="\/lab\/">LAB/);
  assert.match(lab, /<BenchLab\s*\/>/);
  assert.ok(!lab.includes('<RadioMini'));
  assert.match(bench, /<script type="module">[\s\S]*benchRail/);
  assert.match(home, /src="\/assets\/rails\.js"/);
});

test("Lab rail initializes and advances through all three benches", () => {
  const dots = Array.from({ length: 3 }, () => ({
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, callback) { this[name] = callback; },
  }));
  const track = {
    children: [{ offsetLeft: 0 }, { offsetLeft: 300 }, { offsetLeft: 600 }], scrollLeft: 0,
    contains: () => false, addEventListener() {},
    scrollTo({ left }) { this.scrollLeft = left; },
  };
  const toggle = { hidden: true, addEventListener() {} };
  const nav = { querySelectorAll: () => dots, querySelector: () => toggle, contains: () => false };
  let cycle;
  const context = {
    window: {}, document: { hidden: false, getElementById: id => ({ benchRail: track, benchDots: nav })[id] },
    matchMedia: query => ({ matches: query.includes("max-width") }),
    setInterval: (fn, delay) => { assert.equal(delay, 19_000); cycle = fn; },
    requestAnimationFrame: fn => fn(), Date,
  };
  new Script(rail).runInNewContext(context);
  assert.equal(typeof cycle, "function");
  cycle(); assert.equal(track.scrollLeft, 300); assert.equal(dots[1]["aria-pressed"], "true");
  cycle(); assert.equal(track.scrollLeft, 600); assert.equal(dots[2]["aria-pressed"], "true");
  cycle(); assert.equal(track.scrollLeft, 0);
});
