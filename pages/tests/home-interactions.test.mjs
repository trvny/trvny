import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const home = await readFile(new URL("../site/index.html", import.meta.url), "utf8");

test("mobile rails retain direct card links and accessible slide controls", () => {
  assert.match(home, /class="feature-rail" id="featureRail"/);
  assert.match(home, /class="benchgrid" id="benchRail"/);
  assert.equal([...home.matchAll(/class="panel (?:tv|wx)"/g)].length, 2);
  assert.equal([...home.matchAll(/class="bench (?:stream|code|doc)"/g)].length, 3);
  assert.equal([...home.matchAll(/data-slide="[012]" aria-label=/g)].length, 5);
  assert.match(home, /scroll-snap-type:x mandatory/);
  assert.match(home, /prefers-reduced-motion:reduce/);
  assert.match(home, /pauseUntil=Date\.now\(\)\+delay\*2/);
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
  assert.match(home, /data-slide="0" aria-label="Weather" aria-pressed="true"/);
  assert.match(home, /data-slide="1" aria-label="TV status" aria-pressed="false"/);

  const begin = home.indexOf("function setupRail(");
  const end = home.indexOf('\nsetupRail("featureRail"', begin);
  assert.ok(begin > 0 && end > begin);
  const script = home.slice(begin, end);
  const events = {};
  const dots = Array.from({ length: 2 }, () => ({
    state: null,
    setAttribute(name, value) {
      if (name === "aria-pressed") this.state = value;
    },
    addEventListener(name, callback) { this[name] = callback; },
  }));
  const track = {
    children: [{ offsetLeft: 0 }, { offsetLeft: 360 }],
    scrollLeft: 0,
    addEventListener(name, callback) { events[name] = callback; },
    scrollTo({ left }) { this.scrollLeft = left; },
  };
  const nav = { querySelectorAll: () => dots };
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
  new Script(script).runInNewContext(context);
  context.setupRail("featureRail", "featureDots", 10_000);
  assert.equal(dots[0].state, null);
  cycle();
  assert.equal(track.scrollLeft, 360);
  assert.equal(dots[1].state, "true");

  clock = 1_000;
  events.pointerdown();
  cycle();
  assert.equal(track.scrollLeft, 360);
  clock = 22_000;
  cycle();
  assert.equal(track.scrollLeft, 0);
  assert.equal(dots[0].state, "true");
});
