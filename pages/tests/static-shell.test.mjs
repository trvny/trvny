import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { STATIC_PAGES, staticPaths, renderStaticShell, staticHeaders, writeStaticShell } from "../scripts/build-static-shell.mjs";

const root = new URL("../", import.meta.url);
const source = page => readFile(new URL(page.source ?? "site/" + page.file, root), "utf8");

test("each real static HTML source receives one shared shell and preserves its content", async () => {
  for (const page of STATIC_PAGES) {
    const html = await source(page);
    const rendered = renderStaticShell(html, page);
    assert.equal(renderStaticShell(rendered, page), rendered, page.file);
    assert.equal(rendered.match(/id="trvny-nav-toggle"/g)?.length, 1, page.file);
    assert.equal(rendered.match(/src="\/assets\/nav.js"/g)?.length, 1, page.file);
    assert.equal(rendered.match(/src="\/assets\/webmcp.js"/g)?.length, 1, page.file);
    const original = rendered.replace(/<!-- hub-shell:head:start -->[\s\S]*?<!-- hub-shell:head:end -->/, "")
      .replace(/<!-- hub-shell:body:start -->[\s\S]*?<!-- hub-shell:body:end -->/, "");
    assert.equal(original, html, page.file);
    if (page.page === "papagenerator" || page.page === "token-worldcup") {
      assert.match(rendered, new RegExp('rel="canonical" href="https://travny.pages.dev' + page.path + '"'));
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
    await mkdir(dirname(join(path, page.file)), { recursive: true });
    await writeFile(new URL(page.file, dir), await source(page));
  }
  await writeStaticShell(dir);
  await writeStaticShell(dir);
  const headers = await readFile(new URL("_headers", dir), "utf8");
  assert.equal(headers, staticHeaders());
  for (const page of STATIC_PAGES) {
    assert.equal(await readFile(new URL(page.file, dir), "utf8"), renderStaticShell(await source(page), page));
    for (const alias of staticPaths(page)) {
      assert.ok(headers.includes("\n" + alias + "\n  Content-Language: " + page.lang + "\n"), alias);
    }
  }
  assert.ok(headers.includes("/teksty/githubowa-kraina/index.md>; rel=\"alternate\""));
  assert.ok(headers.includes("X-Robots-Tag: noindex, follow"));
  await writeFile(new URL("_headers", dir), "/manual\n  X-Example: keep\n");
  await assert.rejects(writeStaticShell(dir), /Refusing to overwrite/);
});
