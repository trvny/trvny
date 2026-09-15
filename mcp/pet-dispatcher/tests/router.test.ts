import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  probeExecutorAdapters,
  probeModelBackends,
  probeRouting,
  findCommandOnPath,
  rankExecutorProbes,
  rankModelBackendProbes,
  type ModelBackendProbe,
} from "../src/agent-router.js";

const env = {
  OPENROUTER_API_KEY: "test-openrouter-key",
  AIHUBMIX_API_KEY: "test-aihubmix-key",
} as NodeJS.ProcessEnv;

test("backend probes expose availability without leaking credential values", async () => {
  const probes = await probeModelBackends({ env });
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  assert.equal(byId.get("openrouter")?.availability, "available");
  assert.equal(byId.get("aihubmix")?.availability, "available");
  assert.equal(byId.get("groq")?.availability, "unavailable");
  const serialized = JSON.stringify(probes);
  assert.equal(serialized.includes("test-openrouter-key"), false);
  assert.equal(serialized.includes("test-aihubmix-key"), false);
});

test("zero-cost router defaults are ready while ambiguous model choices require opt-in", async () => {
  const probes = await probeModelBackends({ env: {
    ORCAROUTER_API_KEY: "test-orca-key",
    OLLAMA_API_KEY: "test-ollama-key",
    GROQ_API_KEY: "test-groq-key",
  } as NodeJS.ProcessEnv });
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  assert.equal(byId.get("orcarouter")?.availability, "available");
  assert.equal(byId.get("ollama-cloud")?.availability, "degraded");
  assert.equal(byId.get("groq")?.availability, "degraded");
  assert.equal(JSON.stringify(probes).includes("test-orca-key"), false);
});
test("executor probes expose contracts and degrade safely", async () => {
  const probes = await probeExecutorAdapters({
    env,
    findCommand: async (command) => {
      if (["copilot", "vibe", "hermes", "codex"].includes(command)) return `C:/bin/${command}.exe`;
      if (command === "opencode") throw new Error("probe failed at C:/private/path");
      return undefined;
    },
  });
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  assert.equal(byId.get("direct")?.availability, "available");
  assert.equal(byId.get("openrouter")?.backendMode, "selectable");
  assert.deepEqual(byId.get("openrouter")?.backendIds, ["openrouter", "orcarouter", "aihubmix", "ollama-cloud", "groq"]);
  assert.equal(byId.get("copilot")?.availability, "available");
  assert.equal(byId.get("opencode")?.availability, "degraded");
  assert.equal(byId.get("opencode")?.backendMode, "selectable");
  assert.deepEqual(byId.get("opencode")?.capabilities, []);
  assert.equal(byId.get("opencode")?.reason, "command probe failed");
  assert.equal(byId.get("gemini")?.availability, "unavailable");
});


test("embedded OpenAI executor is available through any configured compatible backend", async () => {
  const probes = await probeExecutorAdapters({
    env: { AIHUBMIX_API_KEY: "test-aihubmix-key", PET_DISPATCHER_AIHUBMIX_MODEL: "coding-glm-5.3-free" } as NodeJS.ProcessEnv,
    findCommand: async () => undefined,
  });
  const openai = probes.find(({ id }) => id === "openrouter");
  assert.equal(openai?.availability, "available");
  assert.equal(openai?.backendMode, "selectable");
});
test("backend ranking is deterministic, healthy-first and free-first", () => {
  const probes: ModelBackendProbe[] = [
    { id: "paid", availability: "available", costClass: "metered", priority: 1 },
    { id: "free-b", availability: "available", costClass: "free-tier", priority: 20 },
    { id: "free-a", availability: "available", costClass: "free-tier", priority: 10 },
    { id: "free-degraded", availability: "degraded", costClass: "free-tier", priority: 0 },
  ];
  assert.deepEqual(rankModelBackendProbes(probes).map(({ id }) => id), [
    "free-a", "free-b", "paid", "free-degraded",
  ]);
});

test("executor ranking keeps planned host CLIs out of automatic routing", async () => {
  const probes = await probeExecutorAdapters({
    env,
    findCommand: async (command) => command === "hermes" ? "C:/bin/hermes.exe" : undefined,
  });
  assert.deepEqual(rankExecutorProbes(probes, { taskKind: "agent" }).map(({ id }) => id), ["openrouter"]);
  assert.deepEqual(
    rankExecutorProbes(probes, { taskKind: "agent", includePlanned: true }).map(({ id }) => id),
    ["openrouter", "hermes"],
  );
  assert.deepEqual(rankExecutorProbes(probes, { taskKind: "direct" }).map(({ id }) => id), ["direct"]);
});

test("routing snapshot reports unavailable adapters but prefers only active healthy ones", async () => {
  const snapshot = await probeRouting({ env, findCommand: async () => undefined });
  assert.equal(snapshot.executors.some(({ id }) => id === "copilot"), true);
  assert.deepEqual(snapshot.preferred.direct, ["direct"]);
  assert.deepEqual(snapshot.preferred.agent, ["openrouter"]);
  assert.deepEqual(snapshot.preferred.backends.slice(0, 2), ["openrouter", "aihubmix"]);
});

test("degraded executors are diagnostic only, never automatic", async () => {
  const probes = await probeExecutorAdapters({ env, findCommand: async () => undefined });
  const degraded = probes.map((probe) => probe.id === "openrouter"
    ? { ...probe, availability: "degraded" as const }
    : probe);
  assert.deepEqual(rankExecutorProbes(degraded, { taskKind: "agent" }), []);
});

test("PATH probe rejects path-like command names before filesystem lookup", async () => {
  const cleanEnv = { PATH: "C:/safe/bin" } as NodeJS.ProcessEnv;
  await assert.rejects(findCommandOnPath("../secret", cleanEnv), /safe command basename/u);
  await assert.rejects(findCommandOnPath("sub/tool", cleanEnv), /safe command basename/u);
  await assert.rejects(findCommandOnPath("sub\\tool", cleanEnv), /safe command basename/u);
});

test("PATH probe ignores directories named like commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-router-"));
  const candidate = process.platform === "win32" ? "codex.EXE" : "codex";
  await mkdir(join(root, candidate));
  const cleanEnv = process.platform === "win32"
    ? { PATH: root, PATHEXT: ".EXE" } as NodeJS.ProcessEnv
    : { PATH: root } as NodeJS.ProcessEnv;
  try {
    assert.equal(await findCommandOnPath("codex", cleanEnv), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
