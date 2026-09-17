import assert from "node:assert/strict";
import test from "node:test";
import { proxyKanarekFreeRouter } from "../control-plane/free-router.js";

test("free-router proxy injects only the shared Kanarek router credential", async () => {
  let forwarded: Request | undefined;
  const response = await proxyKanarekFreeRouter(JSON.stringify({ model: "kanarek-review-free" }), {
    KANAREK_REVIEW_ROUTER_TOKEN: "router-secret",
    KANAREK_COMPANION: {
      async fetch(input) {
        forwarded = input instanceof Request ? input : new Request(input);
        return Response.json({ ok: true });
      },
    },
  });
  assert.equal(response.ok, true);
  assert.equal(new URL(forwarded?.url ?? "https://invalid").pathname, "/review-router/v1/chat/completions");
  assert.equal(forwarded?.headers.get("authorization"), "Bearer router-secret");
});

test("free-router proxy fails closed when its shared credential is unavailable", async () => {
  const response = await proxyKanarekFreeRouter("{}", {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "free_router_unavailable" });
});
