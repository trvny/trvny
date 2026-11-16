import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeBadgePreviews } from "../scripts/build-badge-previews.mjs";

test("build emits static previews without replacing public badge paths or live probes", async t => {
  const path = await mkdtemp(join(tmpdir(), "hub-badge-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  const dir = pathToFileURL(path + "/");
  const calls = [];
  const data = await writeBadgePreviews(dir, async url => {
    calls.push(url);
    if (url.includes("@primer/octicons")) return new Response("missing", { status: 404 });
    return new Response('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');
  });
  const bySlug = new Map(data.badges.map(row => [row.slug, row]));
  const brand = bySlug.get("twojstar");
  assert.equal(brand.path, "/badge/twojstar.svg");
  assert.equal(brand.preview, "/assets/badge-previews/twojstar.svg");
  assert.match(await readFile(new URL("twojstar.svg", dir), "utf8"), />twojstar<\/text>/);
  assert.equal(bySlug.get("feedseek").preview, undefined);
  assert.equal(bySlug.get("status/kanarek").preview, undefined);
  assert.equal(bySlug.get("tvpi/channels").preview, undefined);
  assert.ok(calls.every(url => url.startsWith("https://cdn.jsdelivr.net/npm/")));
  assert.deepEqual(JSON.parse(await readFile(new URL("catalogue.json", dir), "utf8")), data);
});
