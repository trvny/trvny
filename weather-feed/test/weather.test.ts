import assert from "node:assert/strict";
import test from "node:test";
import { FEED_ID, renderAtom, warningEntries } from "../src/feed";
import type { Warning } from "../src/types";
import { reconcileWarnings } from "../src/warnings";

const meteo: Warning = {
  id: "meteo:1", category: "meteo", event: "Burze", level: 2,
  probability: 80, from: "2026-07-22T12:00:00", to: "2026-07-22T18:00:00", content: "Burze z gradem",
};
const hydro: Warning = {
  id: "hydro:1", category: "hydro", event: "Gwałtowne wzrosty stanów wody", level: 1,
  probability: null, from: null, to: null, content: "Możliwe wzrosty",
};

test("failed IMGW category preserves its previous warnings", () => {
  const next = reconcileWarnings([meteo, hydro], { warnings: [], succeeded: ["meteo"] });
  assert.deepEqual(next, [hydro]);
  const entries = warningEntries([meteo, hydro], next);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "warning_lifted");
  assert.match(entries[0]?.title ?? "", /Burze/);
  assert.doesNotMatch(entries[0]?.title ?? "", /wzrosty/);
});

test("total IMGW outage preserves all warnings and emits no lift", () => {
  const next = reconcileWarnings([meteo, hydro], { warnings: [], succeeded: [] });
  assert.deepEqual(next, [meteo, hydro]);
  assert.deepEqual(warningEntries([meteo, hydro], next), []);
});

test("warnings feed has its own id and self URL", () => {
  const xml = renderAtom([], "Warnings", "https://weather.example", "/warnings.atom", `${FEED_ID}:warnings`);
  assert.match(xml, /<id>tag:travny,2026:weather:koscielec:warnings<\/id>/);
  assert.match(xml, /rel="self" href="https:\/\/weather\.example\/warnings\.atom"/);
  assert.doesNotMatch(xml, /rel="self" href="https:\/\/weather\.example\/feed\.atom"/);
});
