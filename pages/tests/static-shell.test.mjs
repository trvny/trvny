import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { STATIC_PAGES, staticPaths, renderStaticShell, staticHeaders, writeStaticShell } from "../scripts/build-static-shell.mjs";

import { worldcupData, renderWorldcupPolish, renderWorldcupEnglish } from "../scripts/worldcup-seo.mjs";

const root = new URL("../", import.meta.url);
const stripShell = html => html.replace(/<!-- hub-shell:head:start -->[\s\S]*?<!-- hub-shell:head:end -->/, "")
  .replace(/<!-- hub-shell:body:start -->[\s\S]*?<!-- hub-shell:body:end -->/, "");
const source = async page => {
  const html = stripShell(await readFile(new URL(page.source ?? "site/" + page.file, root), "utf8"));
  return page.generatedFrom ? renderWorldcupEnglish(html) : html;
};

test("each real static HTML source receives one shared shell and preserves its content", async () => {
  for (const page of STATIC_PAGES) {
    const html = await source(page);
    const rendered = renderStaticShell(html, page);
    assert.equal(renderStaticShell(rendered, page), rendered, page.file);
    assert.equal(rendered.match(/id="trvny-nav-toggle"/g)?.length, 1, page.file);
    assert.equal(rendered.match(/src="\/assets\/nav.js"/g)?.length, 1, page.file);
    assert.equal(rendered.match(/src="\/assets\/webmcp.js"/g)?.length, 1, page.file);
    const original = stripShell(rendered);
    assert.equal(original, page.page === "token-worldcup" ? renderWorldcupPolish(html) : html, page.file);
    if (page.page === "papagenerator" || page.page === "token-worldcup") {
      assert.ok(rendered.includes('rel="canonical" href="https://bartek.lol' + page.path + '"'));
    }
    if (page.noindex) {
      assert.match(rendered, /<meta name="robots" content="noindex,follow">/);
      assert.doesNotMatch(rendered, /rel="canonical"/);
    }
    if (page.file !== "badges/index.html") assert.match(rendered, /"@type":"BreadcrumbList"/);
  }
});

test("build writes all documents and static headers; repeat build is stable", async t => {
  const path = await mkdtemp(join(tmpdir(), "hub-shell-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  const dir = pathToFileURL(path + "/");
  await writeFile(new URL("_routes.json", dir), await readFile(new URL("site/_routes.json", root)));
  for (const page of STATIC_PAGES) {
    if (page.generatedFrom) continue;
    await mkdir(dirname(join(path, page.file)), { recursive: true });
    await writeFile(new URL(page.file, dir), await source(page));
  }
  await assert.rejects(readFile(new URL("teksty/token-worldcup/en/index.html", dir)), { code: "ENOENT" });
  await writeStaticShell(dir);
  assert.match(await readFile(new URL("teksty/token-worldcup/en/index.html", dir), "utf8"), /AI Token Worldcup/);
  await writeStaticShell(dir);
  const rows = worldcupData(await readFile(new URL("teksty/token-worldcup/index.html", dir), "utf8"));
  assert.deepEqual(JSON.parse(await readFile(new URL("teksty/token-worldcup/dataset.json", dir), "utf8")), rows);
  const headers = await readFile(new URL("_headers", dir), "utf8");
  assert.equal(headers, staticHeaders());
  const blocks = new Map();
  let current;
  for (const line of headers.split("\n")) {
    if (line.startsWith("/")) {
      current = [];
      blocks.set(line, current);
    } else if (line.startsWith("  ")) current.push(line.trim());
  }
  for (const page of STATIC_PAGES) {
    assert.equal(await readFile(new URL(page.file, dir), "utf8"), renderStaticShell(await source(page), page));
    for (const alias of staticPaths(page)) {
      const block = blocks.get(alias);
      assert.ok(block, alias);
      assert.ok(block.includes("Content-Language: " + page.lang), alias);
      assert.equal(block.includes("X-Robots-Tag: noindex, follow"), Boolean(page.noindex), alias);
      assert.ok(block.includes("Link: " + (page.markdown ? "<" + page.markdown + '>; rel="alternate"; type="text/markdown", ' : "") + '</llms.txt>; rel="describedby"'), alias);
    }
  }
  assert.ok(headers.includes("/teksty/githubowa-kraina/index.md>; rel=\"alternate\""));
  assert.ok(headers.includes('</llms.txt>; rel="describedby"'));
  assert.ok(headers.includes("X-Robots-Tag: noindex, follow"));
  await writeFile(new URL("_headers", dir), "/manual\n  X-Example: keep\n");
  await assert.rejects(writeStaticShell(dir), /Refusing to overwrite/);
  assert.equal(await readFile(new URL("_headers", dir), "utf8"), "/manual\n  X-Example: keep\n");
});

test("worldcup exposes the same corpus in HTML, English report and Dataset schema", async () => {
  const raw = await readFile(new URL("token-worldcup/token-worldcup.html", root), "utf8");
  const rows = worldcupData(raw);
  const pl = renderWorldcupPolish(raw), en = renderWorldcupEnglish(raw);
  assert.equal(renderWorldcupPolish(pl), pl);
  for (const row of rows) {
    assert.ok(pl.includes('>' + row.name + '</td>'));
    assert.ok(en.includes('>' + row.name + '</th>'));
  }
  for (const html of [pl,en]) {
    assert.match(html, /"@type":"Article"/);
    assert.match(html, /"@type":"Dataset"/);
    assert.match(html, /dataset\.json/);
  }
  assert.equal((pl.match(/<tbody id="tableBody">[\s\S]*?<\/tbody>/)[0].match(/<tr>/g) || []).length, rows.length);
  assert.equal((en.match(/<tbody>[\s\S]*?<\/tbody>/)[0].match(/<tr>/g) || []).length, rows.length);
  const url = "https://bartek.lol/teksty/token-worldcup/en/";
  assert.ok(en.includes('rel="canonical" href="' + url + '"'));
  assert.ok((await readFile(new URL("site/sitemap.xml", root), "utf8")).includes("<loc>" + url + "</loc>"));
});
