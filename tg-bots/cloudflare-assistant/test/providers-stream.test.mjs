import assert from "node:assert/strict";
import test from "node:test";

import {
  GenerationStoppedError,
  chatWithStreamingFallback,
  chatWithInlineFallback,
  completeWithFallback,
  describeImage,
  transcribeAudio,
  workersAiAvailable,
} from "../src/providers.ts";

function envWithRouter(fetcher, aiRun = async () => ({ response: "local fallback" })) {
  return {
    KANAREK_REVIEW_ROUTER_TOKEN: "router-token",
    KANAREK_COMPANION: { fetch: fetcher },
    WORKERS_AI_ENABLED: "true",
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

test("Workers AI availability follows the binding and kill switch", () => {
  const env = envWithRouter(async () => Response.json({}));
  assert.equal(workersAiAvailable(env), true);
  env.WORKERS_AI_ENABLED = "false";
  assert.equal(workersAiAvailable(env), false);
  delete env.AI;
  env.WORKERS_AI_ENABLED = "true";
  assert.equal(workersAiAvailable(env), false);
});

test("does not use local Workers AI when disabled", async () => {
  let localCalls = 0;
  const env = envWithRouter(
    async () => new Response("router unavailable", { status: 502 }),
    async () => {
      localCalls += 1;
      return { response: "must not run" };
    },
  );
  env.WORKERS_AI_ENABLED = "false";

  await assert.rejects(
    chatWithStreamingFallback(env, [{ role: "user", content: "hi" }]),
    /Workers AI is disabled or unbound/,
  );
  assert.equal(localCalls, 0);
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
    async () => new Promise(() => {}),
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


test("stops while waiting for shared-router response headers", async () => {
  let stop = false;
  let localCalls = 0;
  const env = envWithRouter(
    async () => new Promise(() => {}),
    async () => {
      localCalls += 1;
      return { response: "must not run" };
    },
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
  assert.equal(localCalls, 0);
});

test("bounds local GLM inference and accepts chat completion responses", async () => {
  const messages = [{ role: "user", content: "hi" }];
  const calls = [];
  const env = envWithRouter(
    async () => new Response("unavailable", { status: 502 }),
    async (model, input) => {
      calls.push({ model, input });
      return { choices: [{ message: { content: "answer" } }] };
    },
  );
  env.WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
  assert.equal((await chatWithStreamingFallback(env, messages)).text, "answer");
  assert.equal((await chatWithInlineFallback(env, messages)).text, "answer");
  assert.equal((await completeWithFallback(env, messages, (text) => text)).value, "answer");
  assert.deepEqual(calls.map(({ input }) => input.max_completion_tokens), [10240, 384, 1024]);
  assert.deepEqual(calls.map(({ input }) => input.chat_template_kwargs.enable_thinking), [true, false, false]);
});

for (const [mode, invoke, deadline] of [
  ["chat", chatWithStreamingFallback, 45_000],
  ["inline", chatWithInlineFallback, 3_500],
]) {
  test(`local ${mode} fallback times out without a second inference`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let started;
    const called = new Promise((resolve) => { started = resolve; });
    let calls = 0;
    const env = envWithRouter(
      async () => new Response("unavailable", { status: 502 }),
      async () => {
        calls += 1;
        started();
        return new Promise(() => {});
      },
    );
    const result = invoke(env, [{ role: "user", content: "hi" }]);
    const rejected = assert.rejects(result, new RegExp(`Workers AI timed out after ${deadline}ms`));
    await called;
    t.mock.timers.tick(deadline);
    await rejected;
    assert.equal(calls, 1);
  });
}

test("voice and vision use their own inference contracts", async () => {
  const calls = [];
  const env = envWithRouter(
    async () => new Response("unused", { status: 502 }),
    async (model, input) => {
      calls.push({ model, input });
      if (model.includes("whisper")) return { text: "transcript" };
      return { response: "photo description" };
    },
  );
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  assert.equal(await transcribeAudio(env, bytes), "transcript");
  assert.equal((await describeImage(env, bytes)).text, "photo description");
  assert.equal(calls[0].model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(calls[0].input.task, "transcribe");
  assert.equal(calls[0].input.vad_filter, true);
  assert.equal(calls[0].input.max_tokens, undefined);
  assert.equal(calls[1].model, "@cf/meta/llama-3.2-11b-vision-instruct");
  assert.equal(calls[1].input.max_tokens, 1024);
  for (const { input } of calls) assert.equal(input.chat_template_kwargs, undefined);
});
