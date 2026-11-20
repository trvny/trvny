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
  const request = (path, method = "GET") => new Request("https://bartek.lol" + path, {
    method, headers: { accept: "text/markdown" },
  });
  const env = { ASSETS: { fetch: async req => {
    calls.push(new URL(req.url).pathname);
    return new Response(req.method === "HEAD" ? null : "# TRAVNY", { headers: { etag: "old", "content-type": "text/plain" } });
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


import { onRequest } from "../functions/_middleware.js";

test("atlas variants negotiate Markdown without rewriting pre-rendered HTML", async () => {
  const origin = "https://bartek.lol";
  for (const suffix of ["", "/", "/index.html"]) {
    const path = "/teksty/githubowa-kraina" + suffix;
    const env = { ASSETS: { fetch: async req => {
      assert.equal(new URL(req.url).pathname, "/teksty/githubowa-kraina/index.md");
      return new Response("# Atlas");
    } } };
    const md = await onRequest({ request: new Request(origin + path, { headers: { accept: "text/markdown" } }), env });
    assert.equal(await md.text(), "# Atlas");
    const html = await onRequest({ request: new Request(origin + path), next: async () => new Response("<html>shell</html>", { headers: { "content-type": "text/html" } }) });
    assert.equal(await html.text(), "<html>shell</html>");
    assert.equal(html.headers.get("vary"), "Accept");
  }
  const redirect = await onRequest({ request: new Request("https://trfny.com/tv/", { headers: { accept: "text/markdown" } }) });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("vary"), "Accept");
});


test("failed Markdown asset fetch falls back to HTML", async () => {
  const request = new Request("https://bartek.lol/teksty/githubowa-kraina/", { headers: { accept: "text/markdown" } });
  const env = { ASSETS: { fetch: async () => { throw new Error("asset unavailable"); } } };
  const response = await onRequest({ request, env, next: async () => new Response("<html>fallback</html>") });
  assert.equal(await response.text(), "<html>fallback</html>");
  assert.equal(response.headers.get("vary"), "Accept");
});
