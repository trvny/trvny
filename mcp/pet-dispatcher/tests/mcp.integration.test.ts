import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import test from "node:test";
import type { DispatcherConfig } from "../src/config.js";
import { CommandRunner } from "../src/sandbox.js";
import { createServer } from "../src/server.js";
import { SessionManager } from "../src/sessions.js";

const config: DispatcherConfig = {
  workspaceRoot: "C:\\pet-dispatcher-test",
  repositories: {},
  toolRoots: [],
  networkProfiles: { github: { hosts: ["api.github.com"] } },
  defaultTimeoutMs: 10_000,
  maxOutputBytes: 1_048_576,
  maxBrokerResponseBytes: 4096,
  openRouterModel: "openrouter/free",
  geminiModel: "gemini-2.5-flash",
};

test("MCP surface initializes and exposes the confined tool set", async () => {
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  const server = createServer(config, sessions, runner);
  const client = new Client({ name: "pet-dispatcher-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    for (const expected of ["security_status", "open_session", "fs_read", "fs_write", "git_status", "git_diff", "git_add", "git_commit", "workspace_exec", "http_fetch", "agent_run"]) {
      assert.equal(names.has(expected), true, `missing MCP tool: ${expected}`);
    }

    const status = await client.callTool({ name: "security_status", arguments: {} });
    const content = (status as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content.find((part) => part.type === "text");
    assert.equal(text?.type, "text");
    const body = JSON.parse(text?.text ?? "{}") as { sandbox?: { networkModes?: Record<string, boolean> } };
    assert.equal(body.sandbox?.networkModes?.brokered, true);
    assert.equal(body.sandbox?.networkModes?.restricted, false);
  } finally {
    await client.close();
    await server.close();
  }
});
