import assert from "node:assert/strict";
import test from "node:test";
import type { DispatcherConfig } from "../src/config.js";
import type { AgentTools } from "../src/agent-tools.js";
import { runOpenRouter } from "../src/providers.js";

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

test("OpenRouter malformed tool calls become tool errors instead of crashing", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let call = 0;
  let secondRequest: Record<string, unknown> | undefined;
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    call++;
    if (call === 1) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", tool_calls: [{ id: "bad-call" }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    secondRequest = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "done" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const tools = {
    execute: async () => { throw new Error("malformed tool call must not execute"); },
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
  const fakeFetch = (async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "read_file", arguments: "{}" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const tools = { execute: async () => { throw new Error("malformed tool call must not execute"); } } as unknown as AgentTools;
  try {
    process.env.OPENROUTER_API_KEY = "test-only";
    globalThis.fetch = fakeFetch;
    await assert.rejects(runOpenRouter(config, tools, "session", "goal", "test-model", 1), /malformed tool_call without id/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
});
