import assert from "node:assert/strict";
import test from "node:test";
import { proxyKanarekFreeRouter, proxyKanarekWorkRouter } from "../control-plane/free-router.js";

function serviceCapture() {
  let forwarded: Request | undefined;
  return {
    get forwarded() { return forwarded; },
    binding: {
      async fetch(input: Request | string) {
        forwarded = input instanceof Request ? input : new Request(input);
        return Response.json(
          { choices: [{ message: { role: "assistant", content: "done" } }] },
          { headers: { "x-kanarek-review-provider": "deepseek" } },
        );
      },
    },
  };
}

test("free-router proxy pins the free model and preserves provider identity", async () => {
  const captured = serviceCapture();
  const response = await proxyKanarekFreeRouter(JSON.stringify({ model: "kanarek-work-paid", messages: [] }), {
    KANAREK_REVIEW_ROUTER_TOKEN: "router-test-value",
    KANAREK_COMPANION: captured.binding,
  });
  assert.equal(response.ok, true);
  assert.equal(new URL(captured.forwarded?.url ?? "https://invalid").pathname, "/review-router/v1/chat/completions");
  assert.equal(captured.forwarded?.headers.get("authorization"), "Bearer router-test-value");
  assert.equal((await captured.forwarded?.clone().json() as { model?: string }).model, "kanarek-review-free");
  assert.equal(response.headers.get("x-kanarek-review-provider"), "deepseek");
});

test("work-router proxy pins the paid work model", async () => {
  const captured = serviceCapture();
  const response = await proxyKanarekWorkRouter(JSON.stringify({ model: "kanarek-review-free", messages: [] }), {
    KANAREK_REVIEW_ROUTER_TOKEN: "router-test-value",
    KANAREK_COMPANION: captured.binding,
  });
  assert.equal(response.ok, true);
  assert.equal((await captured.forwarded?.clone().json() as { model?: string }).model, "kanarek-work-paid");
  assert.equal(response.headers.get("x-kanarek-review-provider"), "deepseek");
});

test("managed router proxies fail closed when their shared credential is unavailable", async () => {
  const free = await proxyKanarekFreeRouter("{}", {});
  const work = await proxyKanarekWorkRouter("{}", {});
  assert.equal(free.status, 503);
  assert.equal(work.status, 503);
  assert.deepEqual(await free.json(), { error: "free_router_unavailable" });
  assert.deepEqual(await work.json(), { error: "work_router_unavailable" });
});
