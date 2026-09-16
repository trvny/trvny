import assert from "node:assert/strict";
import test from "node:test";
import type { DispatcherConfig } from "../src/config.js";
import type { AgentTools } from "../src/agent-tools.js";
import { AGENT_PROVIDER_ENV_NAMES, runOpenRouter, runRoutedOpenAI } from "../src/providers.js";

const config: DispatcherConfig = {
  workspaceRoot: "C:\\work",
  repositories: {},
  toolRoots: [],
  networkProfiles: {},
  defaultTimeoutMs: 10_000,
  maxOutputBytes: 4096,
  maxBrokerResponseBytes: 4096,
  openRouterModel: "openrouter/free",
  geminiModel: "gemini-2.5-flash",
};

test("provider environment names come from the shared backend registry", () => {
  assert.deepEqual(AGENT_PROVIDER_ENV_NAMES, [
    "AIHUBMIX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY",
    "OPENROUTER_API_KEY", "ORCAROUTER_API_KEY", "PET_DISPATCHER_AIHUBMIX_MODEL",
    "PET_DISPATCHER_GROQ_MODEL", "PET_DISPATCHER_OLLAMA_CLOUD_MODEL",
  ]);
});

test("OpenRouter malformed tool calls become tool errors instead of crashing", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let call = 0;
  let secondRequest: Record<string, unknown> | undefined;
  const fakeFetch = ((_input: string | URL | Request, init?: RequestInit) => {
    call++;
    if (call === 1) {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", tool_calls: [{ id: "bad-call" }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    secondRequest = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "done" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  const tools = {
    execute: () => Promise.reject(new Error("malformed tool call must not execute")),
  } as unknown as AgentTools;
  try {
    process.env.OPENROUTER_API_KEY = "test-only";
    globalThis.fetch = fakeFetch;
    const result = await runOpenRouter(config, tools, "session", "goal", "test-model", 2);
    assert.equal(result.text, "done");
    assert.equal(result.steps, 2);
    const messages = (secondRequest?.messages ?? []) as Array<Record<string, unknown>>;
    assert.equal(messages.some((message) => message.name === "invalid_tool_call"), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});


test("OpenRouter rejects tool calls that omit tool_call_id", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const fakeFetch = (() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "read_file", arguments: "{}" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }))) as typeof fetch;
  const tools = { execute: () => Promise.reject(new Error("malformed tool call must not execute")) } as unknown as AgentTools;
  try {
    process.env.OPENROUTER_API_KEY = "test-only";
    globalThis.fetch = fakeFetch;
    await assert.rejects(runOpenRouter(config, tools, "session", "goal", "test-model", 1), /malformed tool_call without id/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test("OpenRouter compatibility executor falls back to the next healthy OpenAI backend", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalOrca = process.env.ORCAROUTER_API_KEY;
  let requestUrl = "";
  let authorization = "";
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "orca done" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ORCAROUTER_API_KEY = "test-orca-only";
    const tools = { execute: () => Promise.reject(new Error("no tools expected")) } as unknown as AgentTools;
    const result = await runRoutedOpenAI(config, tools, "session", "goal");
    assert.equal(result.provider, "orcarouter");
    assert.equal(result.model, "orcarouter/free");
    assert.equal(requestUrl, "https://api.orcarouter.ai/v1/chat/completions");
    assert.equal(authorization, "Bearer test-orca-only");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalOpenRouter;
    if (originalOrca === undefined) delete process.env.ORCAROUTER_API_KEY; else process.env.ORCAROUTER_API_KEY = originalOrca;
  }
});

test("routed OpenAI retries the next backend after a pre-tool provider failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalOrca = process.env.ORCAROUTER_API_KEY;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("openrouter.ai")) {
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "orca recovered" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.ORCAROUTER_API_KEY = "test-orca";
    const tools = { execute: () => Promise.reject(new Error("no tools expected")) } as unknown as AgentTools;
    const result = await runRoutedOpenAI(config, tools, "session", "goal");
    assert.equal(result.provider, "orcarouter");
    assert.equal(result.text, "orca recovered");
    assert.deepEqual(urls, [
      "https://openrouter.ai/api/v1/chat/completions",
      "https://api.orcarouter.ai/v1/chat/completions",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouter;
    if (originalOrca === undefined) delete process.env.ORCAROUTER_API_KEY;
    else process.env.ORCAROUTER_API_KEY = originalOrca;
  }
});

test("routed OpenAI never switches providers after a tool side effect", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalOrca = process.env.ORCAROUTER_API_KEY;
  let openRouterCalls = 0;
  let orcaCalls = 0;
  let toolCalls = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    if (String(input).includes("openrouter.ai")) {
      openRouterCalls++;
      if (openRouterCalls === 1) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: {
        role: "assistant", tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
      } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    }
    orcaCalls++;
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "must not run" } }] }), { status: 200 }));
  }) as typeof fetch;
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.ORCAROUTER_API_KEY = "test-orca";
    const tools = { execute: async () => { toolCalls++; return { content: "x" }; } } as unknown as AgentTools;
    await assert.rejects(runRoutedOpenAI(config, tools, "session", "goal"), /openrouter 429/u);
    assert.equal(toolCalls, 1);
    assert.equal(openRouterCalls, 2);
    assert.equal(orcaCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalOpenRouter;
    if (originalOrca === undefined) delete process.env.ORCAROUTER_API_KEY; else process.env.ORCAROUTER_API_KEY = originalOrca;
  }
});

test("aggregate backend failures redact every credential", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalOrca = process.env.ORCAROUTER_API_KEY;
  const openKey = "secret-openrouter-value";
  const orcaKey = "secret-orca-value";
  globalThis.fetch = ((input: string | URL | Request) => {
    const body = String(input).includes("openrouter.ai") ? `failure ${openKey}` : `failure ${orcaKey}`;
    return Promise.resolve(new Response(body, { status: 503 }));
  }) as typeof fetch;
  try {
    process.env.OPENROUTER_API_KEY = openKey; process.env.ORCAROUTER_API_KEY = orcaKey;
    const tools = { execute: () => Promise.reject(new Error("no tools expected")) } as unknown as AgentTools;
    await assert.rejects(runRoutedOpenAI(config, tools, "session", "goal"), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes(openKey), false); assert.equal(message.includes(orcaKey), false);
      assert.match(message, /openrouter 503/u); assert.match(message, /orcarouter 503/u);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalOpenRouter;
    if (originalOrca === undefined) delete process.env.ORCAROUTER_API_KEY; else process.env.ORCAROUTER_API_KEY = originalOrca;
  }
});