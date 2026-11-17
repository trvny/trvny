import test from "node:test";
import assert from "node:assert/strict";
import { prefersMarkdown, negotiateMarkdown, varyAccept } from "../functions/_shared/markdown.js";

test("explicit Markdown preference only; honor q values and wildcard fallback", () => {
  for (const a of ["text/markdown", "text/markdown,text/html;q=0.8", "TEXT/MARKDOWN"]) assert.equal(prefersMarkdown(a), true);
  for (const a of ["", "*/*", "text/html", "text/markdown;q=0", "text/html,text/markdown;q=0.5"]) assert.equal(prefersMarkdown(a), false);
  const headers = new Headers({ vary: "Accept-Encoding" });
  varyAccept(headers);
  varyAccept(headers);
  assert.equal(headers.get("vary"), "Accept-Encoding, Accept");
});

test("negotiate only known public guides and preserve HEAD semantics", async () => {
  const calls = [];
  const request = (path, method = "GET") => new Request("https://travny.pages.dev" + path, {
    method, headers: { accept: "text/markdown" },
  });
  const env = { ASSETS: { fetch: async req => {
    calls.push(new URL(req.url).pathname);
    return new Response("# TRAVNY", { headers: { etag: "old", "content-type": "text/plain" } });
  } } };
  const url = new URL(request("/tv/").url);
  const result = await negotiateMarkdown({ request: request("/tv/"), env }, url);
  assert.equal(await result.text(), "# TRAVNY");
  assert.equal(result.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(result.headers.get("vary"), "Accept");
  assert.equal(result.headers.get("etag"), null);
  const head = await negotiateMarkdown({ request: request("/tv/", "HEAD"), env }, url);
  assert.equal(await head.text(), "");
  assert.equal(await negotiateMarkdown({ request: request("/api/test"), env }, new URL(request("/api/test").url)), null);
  assert.deepEqual(calls, ["/tv/index.md", "/tv/index.md"]);
});
