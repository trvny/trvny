import assert from "node:assert/strict";
import test from "node:test";

import { GenerationStoppedError, chatWithStreamingFallback } from "../src/providers.ts";

function envWithRouter(fetcher, aiRun = async () => ({ response: "local fallback" })) {
  return {
    KANAREK_REVIEW_ROUTER_TOKEN: "router-token",
    KANAREK_COMPANION: { fetch: fetcher },
    WORKERS_AI_MODEL: "@cf/test/model",
    AI: { run: aiRun },
  };
}

test("streams OpenAI-compatible SSE deltas through the shared router", async () => {
  const encoder = new TextEncoder();
  const partials = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"model":"m-test","choices":[{"delta":{"content":"Hel'));
      controller.enqueue(encoder.encode('lo"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const env = envWithRouter(async (request) => {
    const body = await request.json();
    assert.equal(body.stream, true);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-kanarek-review-provider": "openrouter",
      },
    });
  });

  const result = await chatWithStreamingFallback(
    env,
    [{ role: "user", content: "hi" }],
    (text) => partials.push(text),
  );

  assert.deepEqual(partials, ["Hello", "Hello world"]);
  assert.deepEqual(result, {
    text: "Hello world",
    provider: "Kanarek/openrouter",
    model: "m-test",
  });
});

test("accepts a non-streaming JSON response from the shared router", async () => {
  let partialCalls = 0;
  const env = envWithRouter(async () => Response.json(
    { model: "workers-json", choices: [{ message: { content: "complete" } }] },
    { headers: { "x-kanarek-review-provider": "workers-ai" } },
  ));

  const result = await chatWithStreamingFallback(
    env,
    [{ role: "user", content: "hi" }],
    () => { partialCalls += 1; },
  );

  assert.equal(partialCalls, 0);
  assert.equal(result.text, "complete");
  assert.equal(result.provider, "Kanarek/workers-ai");
  assert.equal(result.model, "workers-json");
});

test("falls back to the local Workers AI binding when the router fails", async () => {
  let localCalls = 0;
  const env = envWithRouter(
    async () => new Response("router unavailable", { status: 502 }),
    async () => {
      localCalls += 1;
      return { response: "local answer" };
    },
  );

  const result = await chatWithStreamingFallback(env, [{ role: "user", content: "hi" }]);

  assert.equal(localCalls, 1);
  assert.deepEqual(result, {
    text: "local answer",
    provider: "Workers AI",
    model: "@cf/test/model",
  });
});


test("stops an active shared-router stream without falling back", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  let stop = false;
  let localCalls = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"model":"m-stop","choices":[{"delta":{"content":"Partial answer"}}]}\n\n'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const env = envWithRouter(
    async () => new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "x-kanarek-review-provider": "openrouter",
      },
    }),
    async () => {
      localCalls += 1;
      return { response: "must not run" };
    },
  );

  await assert.rejects(
    chatWithStreamingFallback(
      env,
      [{ role: "user", content: "hi" }],
      () => { stop = true; },
      () => stop,
    ),
    (error) => error instanceof GenerationStoppedError && error.partialText === "Partial answer",
  );

  assert.equal(localCalls, 0);
  assert.equal(cancelled, true);
});

test("stops the local Workers AI fallback before delivery", async () => {
  let stop = false;
  const env = envWithRouter(
    async () => new Response("router unavailable", { status: 502 }),
    async () => new Promise((resolve) => setTimeout(() => resolve({ response: "late local answer" }), 2_000)),
  );
  setTimeout(() => { stop = true; }, 30);

  await assert.rejects(
    chatWithStreamingFallback(
      env,
      [{ role: "user", content: "hi" }],
      undefined,
      () => stop,
    ),
    GenerationStoppedError,
  );
});
