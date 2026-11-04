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
  assert.match(home, /manual=true/);
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
