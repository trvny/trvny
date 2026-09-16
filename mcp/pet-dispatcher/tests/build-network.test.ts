import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, type DispatcherConfig } from "../src/config.js";
import { prepareSandboxEnvironment } from "../src/environment.js";
import { assertAllowedConnectAuthority } from "../src/network.js";
import { remoteTaskSchema } from "../src/remote-protocol.js";
import type { Session } from "../src/sessions.js";

function session(root: string, network: Session["network"]): Session {
  return {
    id: "11111111-1111-4111-8111-111111111111", repo: "fixture", writable: true,
    sessionDir: `${root}-session`, root, gitDir: join(root, ".git"), sourceRoot: root,
    initialCommit: "deadbeef", readonlyRoots: [], network, exportedCommit: null, exportedRef: null,
    createdAt: new Date(0).toISOString(),
  };
}

test("config loads one external environment policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-env-config-"));
  try {
    await writeFile(join(root, "env-policy.json"), JSON.stringify({
      secretNamePattern: "TOKEN|KEY|SECRET|PASS|AUTH", expandNames: ["JAVA_HOME"],
      sandboxPassthrough: ["JAVA_HOME"], sandboxReadonlyPathVariables: ["JAVA_HOME"],
      networkProfileSecrets: { cloudflare: ["CLOUDFLARE_API_TOKEN"] },
    }));
    await writeFile(join(root, "dispatcher.json"), JSON.stringify({ workspaceRoot: "./work", repositories: {}, environmentPolicyPath: "./env-policy.json" }));
    const loaded = await loadConfig(join(root, "dispatcher.json"));
    assert.deepEqual(loaded.environmentPolicy?.sandboxPassthrough, ["JAVA_HOME"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});test("sandbox environment keeps custom tool paths but drops unrelated secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-env-"));
  const java = join(root, "jdk");
  await mkdir(java, { recursive: true });
  const config = {
    workspaceRoot: root, repositories: {}, toolRoots: [], networkProfiles: { cloudflare: { hosts: ["api.cloudflare.com"] } },
    defaultTimeoutMs: 10_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 1_048_576,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
    environmentPolicy: {
      secretNamePattern: "TOKEN|KEY|SECRET|PASS|AUTH", expandNames: ["JAVA_HOME"],
      sandboxPassthrough: ["JAVA_HOME"], sandboxReadonlyPathVariables: ["JAVA_HOME"],
      networkProfileSecrets: { cloudflare: ["CLOUDFLARE_API_TOKEN"] },
    },
  } satisfies DispatcherConfig;
  const hostEnv = { SystemRoot: "C:\\Windows", JAVA_HOME: java, OPENROUTER_API_KEY: "nope", CLOUDFLARE_API_TOKEN: "allowed" };
  try {
    const prepared = await prepareSandboxEnvironment(config, session(root, { mode: "brokered", profile: "cloudflare" }), ["C:\\Windows\\System32"], hostEnv);
    assert.equal(prepared.env.JAVA_HOME, java);
    assert.equal(prepared.env.CLOUDFLARE_API_TOKEN, "allowed");
    assert.equal(prepared.env.OPENROUTER_API_KEY, undefined);
    assert.ok(prepared.readonlyRoots.includes(java));
    assert.equal(prepared.env.USERPROFILE?.startsWith(`${root}-session`), true, "sandbox home must live under the session runtime, not the repository");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CONNECT authority uses the same exact-host profile and HTTPS port", () => {
  assert.deepEqual(assertAllowedConnectAuthority("registry.npmjs.org:443", ["registry.npmjs.org"]), { host: "registry.npmjs.org", port: 443 });
  assert.throws(() => assertAllowedConnectAuthority("evil.example:443", ["registry.npmjs.org"]), /outside/);
  assert.throws(() => assertAllowedConnectAuthority("registry.npmjs.org:80", ["registry.npmjs.org"]), /443/);
  assert.throws(() => assertAllowedConnectAuthority("127.0.0.1:443", ["127.0.0.1"]), /IP-literal/);
});test("direct workspace.exec can request one brokered network profile", () => {
  const parsed = remoteTaskSchema.parse({
    repo: "trvny", executor: "direct", profile: "code", timeoutMinutes: 2,
    capabilities: ["workspace.read", "workspace.write", "process.exec", "git.read", "git.commit", "network.fetch"],
    network: { mode: "brokered", profile: "build" },
    direct: { tool: "workspace.exec", autoSession: true, networkProfile: "build", argv: ["npm", "view", "typescript", "version"] },
  });
  assert.equal(parsed.network.profile, "build");
  assert.equal(parsed.direct?.tool, "workspace.exec");
  assert.throws(() => remoteTaskSchema.parse({
    ...parsed,
    capabilities: parsed.capabilities.filter((item) => item !== "network.fetch"),
  }), /network\.fetch/);
  assert.throws(() => remoteTaskSchema.parse({
    ...parsed,
    network: { mode: "brokered", profile: "github" },
  }), /network profile/i);
});
import { connect as connectSocket } from "node:net";
import { once } from "node:events";
import { NetworkBroker } from "../src/network.js";

test("subprocess proxy rejects an unprofiled CONNECT before upstream access", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-proxy-"));
  const proxyConfig = {
    workspaceRoot: root, repositories: {}, toolRoots: [], networkProfiles: { build: { hosts: ["registry.npmjs.org"] } },
    defaultTimeoutMs: 10_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 1_048_576,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  const broker = new NetworkBroker(proxyConfig);
  const opened = await broker.openProxy(session(root, { mode: "brokered", profile: "build" }));
  try {
    const url = new URL(opened.url);
    const client = connectSocket(Number(url.port), url.hostname);
    await once(client, "connect");
    client.write("CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n\r\n");
    const [chunk] = await once(client, "data") as [Buffer];
    assert.match(chunk.toString("ascii"), /^HTTP\/1\.1 403 /u);
    client.destroy();
  } finally {
    await opened.close();
    await rm(root, { recursive: true, force: true });
  }
});