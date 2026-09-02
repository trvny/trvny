import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentTools } from "../src/agent-tools.js";
import { loadConfig } from "../src/config.js";
import {
  remoteTaskSchema,
  signEnvelope,
  validateEnvelopeFreshness,
  verifyEnvelope,
  type RemoteTaskState,
} from "../src/remote-protocol.js";
import {
  CloudflareQueueTransport,
  RemoteJournal,
  RemoteWorker,
  type RemoteTaskExecutor,
} from "../src/remote-transport.js";

const SECRET = "pet-dispatcher-test-secret-0123456789abcdef";

function task() {
  return remoteTaskSchema.parse({
    repo: "trvny",
    goal: "Inspect the repository",
    profile: "code",
    executor: "openrouter",
    network: { mode: "none" },
  });
}
async function signedTask(taskId = "11111111-1111-4111-8111-111111111111") {
  const now = Date.now();
  return signEnvelope({
    version: 1,
    taskId,
    deviceId: "legion",
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 60_000,
    task: task(),
  }, SECRET);
}

test("remote envelopes are signed, device-bound and freshness-checked", async () => {
  const signed = await signedTask();
  assert.equal(await verifyEnvelope(signed, SECRET), true);
  validateEnvelopeFreshness(signed, "legion");

  const altered = structuredClone(signed);
  altered.envelope.task.goal = "tampered";
  assert.equal(await verifyEnvelope(altered, SECRET), false);
  assert.throws(() => validateEnvelopeFreshness(signed, "other-device"), /different device/u);

  const expired = structuredClone(signed);
  expired.envelope.expiresAt = Date.now() - 1;
  assert.throws(() => validateEnvelopeFreshness(expired, "legion"), /expired/u);
});

test("agent tool definitions honor task capability profiles", () => {
  const tools = new AgentTools({} as never, {} as never, {} as never, {} as never, new Set(["workspace.read", "git.read"]));
  assert.deepEqual(tools.definitions().map(({ name }) => name), ["list_files", "read_file", "git_status", "git_diff"]);
});
test("remote journal suppresses completed duplicates and fails closed after interruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-journal-"));
  try {
    const path = join(root, "journal.json");
    const journal = new RemoteJournal(path);
    const signed = await signedTask();
    const claim = await journal.claim(signed, "lease-1");
    assert.equal(claim.kind, "claimed");
    await journal.mark(signed.envelope.taskId, "completed", {
      status: "completed",
      summary: "done",
    });

    const reloaded = new RemoteJournal(path);
    const duplicate = await reloaded.claim(signed, "lease-2");
    assert.equal(duplicate.kind, "terminal");
    assert.equal(duplicate.entry.result?.status, "completed");

    const second = await signedTask("22222222-2222-4222-8222-222222222222");
    await reloaded.claim(second, "lease-3");
    const recovered = await new RemoteJournal(path).recoverInterrupted();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "recovery_required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function state(taskId: string, cancelRequested = false): RemoteTaskState {
  const now = new Date().toISOString();
  return {
    taskId, deviceId: "legion", status: cancelRequested ? "cancel_requested" : "running",
    createdAt: now, updatedAt: now, heartbeatAt: now, cancelRequested,
  };
}
function transportConfig(journalPath: string) {
  return {
    enabled: true,
    deviceId: "legion",
    accountId: "a".repeat(32),
    queueId: "b".repeat(32),
    controlPlaneUrl: "https://control.example/",
    queueTokenEnv: "PET_TEST_QUEUE_TOKEN",
    signingSecretEnv: "PET_TEST_SIGNING_SECRET",
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 10,
    visibilityTimeoutMs: 1_800_000,
    journalPath,
  };
}

test("remote worker executes one signed queue task and acknowledges after publishing result", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-worker-"));
  const signed = await signedTask();
  const actions: string[] = [];
  let delivered = false;
  process.env.PET_TEST_QUEUE_TOKEN = "queue-token";
  process.env.PET_TEST_SIGNING_SECRET = SECRET;
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/pull")) {
      if (delivered) return Response.json({ success: true, result: { messages: [] } });
      delivered = true;
      return Response.json({ success: true, result: { messages: [{ lease_id: "lease-1", body: signed }] } });
    }
    if (url.pathname.endsWith("/messages/ack")) {
      actions.push("ack");
      return Response.json({ success: true, result: { ackCount: 1, retryCount: 0 } });
    }    const match = url.pathname.match(/\/v1\/worker\/tasks\/([^/]+)\/(lease|result)$/u);
    if (match) {
      actions.push(match[2] ?? "unknown");
      const taskId = match[1] ?? signed.envelope.taskId;
      return Response.json(state(taskId));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const executor: RemoteTaskExecutor = {
    async execute() {
      actions.push("execute");
      return { status: "completed", summary: "done" };
    },
  };

  try {
    const config = transportConfig(join(root, "journal.json"));
    const transport = new CloudflareQueueTransport(config, fakeFetch);
    const worker = new RemoteWorker(transport, new RemoteJournal(config.journalPath), executor);
    assert.equal(await worker.pollOnce(), true);
    assert.deepEqual(actions, ["lease", "execute", "result", "ack"]);
  } finally {
    delete process.env.PET_TEST_QUEUE_TOKEN;
    delete process.env.PET_TEST_SIGNING_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});
test("remote worker honors cancellation before starting the confined executor", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-cancel-"));
  const signed = await signedTask();
  let executed = false;
  let delivered = false;
  process.env.PET_TEST_QUEUE_TOKEN = "queue-token";
  process.env.PET_TEST_SIGNING_SECRET = SECRET;
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/pull")) {
      if (delivered) return Response.json({ success: true, result: { messages: [] } });
      delivered = true;
      return Response.json({ success: true, result: { messages: [{ lease_id: "lease-cancel", body: signed }] } });
    }
    if (url.pathname.endsWith("/messages/ack")) {
      return Response.json({ success: true, result: { ackCount: 1, retryCount: 0 } });
    }
    const taskId = signed.envelope.taskId;
    if (url.pathname.endsWith("/lease")) return Response.json(state(taskId, true));
    if (url.pathname.endsWith("/result")) return Response.json(state(taskId, true));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const executor: RemoteTaskExecutor = {
    async execute() { executed = true; return { status: "completed", summary: "unexpected" }; },
  };  try {
    const config = transportConfig(join(root, "journal.json"));
    const worker = new RemoteWorker(
      new CloudflareQueueTransport(config, fakeFetch),
      new RemoteJournal(config.journalPath),
      executor,
    );
    assert.equal(await worker.pollOnce(), true);
    assert.equal(executed, false);
  } finally {
    delete process.env.PET_TEST_QUEUE_TOKEN;
    delete process.env.PET_TEST_SIGNING_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});
test("remote task timeout stays below the default queue visibility lease", () => {
  assert.throws(() => remoteTaskSchema.parse({
    repo: "trvny",
    goal: "too long",
    timeoutMinutes: 21,
  }), /<=20/u);
});

test("remote heartbeat cancels an already running confined executor", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-heartbeat-cancel-"));
  const signed = await signedTask();
  const actions: string[] = [];
  let delivered = false;
  process.env.PET_TEST_QUEUE_TOKEN = "queue-token";
  process.env.PET_TEST_SIGNING_SECRET = SECRET;

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/pull")) {
      if (delivered) return Response.json({ success: true, result: { messages: [] } });
      delivered = true;
      return Response.json({ success: true, result: { messages: [{ lease_id: "lease-heartbeat", body: signed }] } });
    }
    if (url.pathname.endsWith("/messages/ack")) {
      actions.push("ack");
      return Response.json({ success: true, result: { ackCount: 1, retryCount: 0 } });
    }
    const taskId = signed.envelope.taskId;
    if (url.pathname.endsWith("/lease")) {
      actions.push("lease");
      return Response.json(state(taskId));
    }
    if (url.pathname.endsWith("/heartbeat")) {
      actions.push("heartbeat");
      return Response.json(state(taskId, true));
    }
    if (url.pathname.endsWith("/result")) {
      actions.push("result");
      return Response.json(state(taskId, true));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const executor: RemoteTaskExecutor = {
    execute(_task, _taskId, signal) {
      actions.push("execute");
      return new Promise((resolve, reject) => {
        if (!signal) return reject(new Error("missing abort signal"));
        if (signal.aborted) return resolve({ status: "cancelled", summary: "cancelled" });
        signal.addEventListener("abort", () => {
          actions.push("aborted");
          resolve({ status: "cancelled", summary: "cancelled" });
        }, { once: true });
      });
    },
  };

  try {
    const config = transportConfig(join(root, "journal.json"));
    const worker = new RemoteWorker(
      new CloudflareQueueTransport(config, fakeFetch),
      new RemoteJournal(config.journalPath),
      executor,
    );
    assert.equal(await worker.pollOnce(), true);
    assert.ok(actions.includes("heartbeat"));
    assert.ok(actions.includes("aborted"));
    assert.deepEqual(actions.slice(-2), ["result", "ack"]);
  } finally {
    delete process.env.PET_TEST_QUEUE_TOKEN;
    delete process.env.PET_TEST_SIGNING_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});

test("a leased task can be re-leased before execution starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-release-"));
  try {
    const path = join(root, "journal.json");
    const signed = await signedTask("33333333-3333-4333-8333-333333333333");
    const journal = new RemoteJournal(path);
    const first = await journal.claim(signed, "lease-old");
    assert.equal(first.kind, "claimed");
    const second = await journal.claim(signed, "lease-new");
    assert.equal(second.kind, "claimed");
    assert.equal(second.entry.leaseId, "lease-new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("result publish failure preserves terminal journal state and retries delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-publish-retry-"));
  const signed = await signedTask("44444444-4444-4444-8444-444444444444");
  const actions: string[] = [];
  let delivered = false;
  process.env.PET_TEST_QUEUE_TOKEN = "queue-token";
  process.env.PET_TEST_SIGNING_SECRET = SECRET;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/pull")) {
      if (delivered) return Response.json({ success: true, result: { messages: [] } });
      delivered = true;
      return Response.json({ success: true, result: { messages: [{ lease_id: "lease-publish", body: signed }] } });
    }
    if (url.pathname.endsWith("/messages/ack")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { acks?: unknown[]; retries?: unknown[] };
      actions.push(body.retries?.length ? "retry" : "ack");
      return Response.json({ success: true, result: { ackCount: body.acks?.length ?? 0, retryCount: body.retries?.length ?? 0 } });
    }
    const taskId = signed.envelope.taskId;
    if (url.pathname.endsWith("/lease")) {
      actions.push("lease");
      return Response.json(state(taskId));
    }
    if (url.pathname.endsWith("/result")) {
      actions.push("result-failed");
      return new Response("temporary failure", { status: 503 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const executor: RemoteTaskExecutor = {
    execute() {
      actions.push("execute");
      return Promise.resolve({ status: "completed", summary: "done" });
    },
  };
  try {
    const config = transportConfig(join(root, "journal.json"));
    const worker = new RemoteWorker(
      new CloudflareQueueTransport(config, fakeFetch),
      new RemoteJournal(config.journalPath),
      executor,
    );
    assert.equal(await worker.pollOnce(), true);
    assert.deepEqual(actions, ["lease", "execute", "result-failed", "retry"]);

    const persisted = await new RemoteJournal(config.journalPath).claim(signed, "lease-redelivered");
    assert.equal(persisted.kind, "terminal");
    assert.equal(persisted.entry.result?.status, "completed");
  } finally {
    delete process.env.PET_TEST_QUEUE_TOKEN;
    delete process.env.PET_TEST_SIGNING_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});

test("remote config requires HTTPS control plane and a 30-minute Queue lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-config-"));
  const path = join(root, "dispatcher.json");
  const base = {
    workspaceRoot: root,
    repositories: { trvny: root },
    remote: {
      enabled: true,
      deviceId: "legion",
      accountId: "a".repeat(32),
      queueId: "b".repeat(32),
      controlPlaneUrl: "https://control.example/",
      visibilityTimeoutMs: 1_800_000,
      journalPath: "journal.json",
    },
  };
  try {
    await writeFile(path, JSON.stringify({
      ...base,
      remote: { ...base.remote, controlPlaneUrl: "http://control.example/" },
    }));
    await assert.rejects(loadConfig(path), /must use HTTPS/u);
    await writeFile(path, JSON.stringify({
      ...base,
      remote: { ...base.remote, visibilityTimeoutMs: 1_799_999 },
    }));
    await assert.rejects(loadConfig(path), />=1800000/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
