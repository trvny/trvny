import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ARD manifest advertises actual public resources with stable identifiers", async () => {
  const catalog = JSON.parse(await readFile(new URL("../site/.well-known/ard.json", import.meta.url), "utf8"));
  assert.equal(catalog.specVersion, "1.0");
  assert.equal(catalog.host.identifier, "bartek.lol");
  assert.ok(catalog.entries.length >= 3);
  const ids = new Set();
  for (const entry of catalog.entries) {
    assert.match(entry.identifier, /^urn:air:bartek\\.lol:/);
    assert.ok(!ids.has(entry.identifier), entry.identifier);
    ids.add(entry.identifier);
    assert.match(entry.type, /^[a-z]+\\/[a-z0-9.+-]+$/);
    assert.match(entry.url, /^https:\\/\\//);
    assert.ok(!("data" in entry), "one delivery method per entry");
    assert.ok(entry.representativeQueries.length >= 2);
  }
  const sources = await Promise.all([
    readFile(new URL("../build.sh", import.meta.url), "utf8"),
    readFile(new URL("../site/llms.txt", import.meta.url), "utf8"),
    readFile(new URL("../functions/_shared/page-shell.js", import.meta.url), "utf8"),
  ]);
  assert.match(sources[0], /cp site\\/\\.well-known\\/ard\\.json site\\/\\.well-known\\/ai-catalog\\.json/);
  assert.match(sources[1], /\\.well-known\\/ard\\.json/);
  assert.match(sources[2], /rel="ard"/);
});
