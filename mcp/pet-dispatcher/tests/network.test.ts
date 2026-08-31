import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, type DispatcherConfig } from "../src/config.js";
import { assertAllowedUrl, NetworkBroker } from "../src/network.js";
import type { Session } from "../src/sessions.js";

const config: DispatcherConfig = {
  workspaceRoot: "C:\\work",
  repositories: {},
  toolRoots: [],
  networkProfiles: {
    github: { hosts: ["github.com", "api.github.com", "*.githubusercontent.com"] },
  },
  defaultTimeoutMs: 120_000,
  maxOutputBytes: 1_048_576,
  maxBrokerResponseBytes: 8,
  openRouterModel: "openrouter/free",
  geminiModel: "gemini-2.5-flash",
};

const session: Session = {
  id: "00000000-0000-4000-8000-000000000000",
  repo: "test",
  sessionDir: "C:\\work\\session-dir",
  root: "C:\\work\\session",
  gitDir: "C:\\work\\session-dir\\git",
  sourceRoot: "C:\\repo",
  initialCommit: "deadbeef",
  readonlyRoots: [],
  network: { mode: "brokered", profile: "github" },
  exportedCommit: null,
  exportedRef: null,
  createdAt: new Date(0).toISOString(),
};
test("URL guard allows only profiled HTTPS destinations", () => {
  assert.equal(assertAllowedUrl("https://api.github.com/repos/trvny/trvny", config.networkProfiles.github!.hosts).hostname, "api.github.com");
  assert.equal(assertAllowedUrl("https://raw.githubusercontent.com/trvny/trvny/main/README.md", config.networkProfiles.github!.hosts).hostname, "raw.githubusercontent.com");
  assert.throws(() => assertAllowedUrl("http://api.github.com", config.networkProfiles.github!.hosts), /HTTPS only/);
  assert.throws(() => assertAllowedUrl("https://evil.example", config.networkProfiles.github!.hosts), /outside/);
  assert.throws(() => assertAllowedUrl("https://127.0.0.1", config.networkProfiles.github!.hosts), /IP-literal/);
  assert.throws(() => assertAllowedUrl("https://[::1]", config.networkProfiles.github!.hosts), /IP-literal/);
  assert.throws(() => assertAllowedUrl("https://user:pass@api.github.com", config.networkProfiles.github!.hosts), /credentials/);
});

test("broker validates every redirect and truncates response bodies", async () => {
  let calls = 0;
  const fakeFetch = (async (input: string | URL | Request) => {
    calls++;
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/start") return new Response(null, { status: 302, headers: { Location: "/final" } });
    return new Response("1234567890", { status: 200, headers: { "Content-Type": "text/plain", "X-Secret": "nope" } });
  }) as typeof fetch;
  const broker = new NetworkBroker(config, fakeFetch);
  const result = await broker.request(session, { url: "https://api.github.com/start" });
  assert.equal(calls, 2);
  assert.equal(result.body, "12345678");
  assert.equal(result.truncated, true);
  assert.equal(result.headers["content-type"], "text/plain");
  assert.equal(result.headers["x-secret"], undefined);
});
test("broker rejects unsafe caller-supplied headers", async () => {
  const broker = new NetworkBroker(config, (async () => new Response("ok")) as typeof fetch);
  await assert.rejects(broker.request(session, { url: "https://api.github.com", accept: "text/plain\r\nX-Evil: yes" }), /invalid Accept/);
  await assert.rejects(broker.request(session, { url: "https://api.github.com", accept: "text/plain\u0000evil" }), /invalid Accept/);
});

test("broker fails closed on redirect to an unprofiled host", async () => {
  const fakeFetch = (async () => new Response(null, {
    status: 302,
    headers: { Location: "https://evil.example/exfil" },
  })) as typeof fetch;
  const broker = new NetworkBroker(config, fakeFetch);
  await assert.rejects(
    broker.request(session, { url: "https://api.github.com/start" }),
    /outside the session network profile/,
  );
});

test("broker refuses sessions without brokered capability", async () => {
  const broker = new NetworkBroker(config, (async () => new Response("ok")) as typeof fetch);
  const offline = { ...session, network: { mode: "none" as const, profile: null } };
  await assert.rejects(broker.request(offline, { url: "https://api.github.com" }), /no brokered network capability/);
});


test("config rejects wildcard rules that span an entire public suffix", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-dispatcher-config-"));
  const path = join(base, "dispatcher.json");
  try {
    await writeFile(path, JSON.stringify({ workspaceRoot: "./work", repositories: {}, networkProfiles: { bad: { hosts: ["*.com"] } } }));
    await assert.rejects(loadConfig(path), /multi-label domain suffix/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
