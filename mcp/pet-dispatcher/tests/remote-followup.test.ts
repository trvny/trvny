import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { remoteTaskSchema, signEnvelope, type RemoteTaskState } from "../src/remote-protocol.js";
import { CloudflareQueueTransport, RemoteJournal, RemoteWorker, type RemoteTaskExecutor } from "../src/remote-transport.js";
import { acquireRemoteWorkerLease } from "../src/remote-worker-lease.js";

const SECRET = "pet-dispatcher-test-secret-0123456789abcdef";

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
    heartbeatIntervalMs: 5_000,
    visibilityTimeoutMs: 1_800_000,
    journalPath,
  };
}
test("remote task schema rejects unknown fields before applying defaults", () => {
  const parsed = remoteTaskSchema.safeParse({
    repo: "trvny",
    goal: "inspect",
    capabilites: ["workspace.read"],
  });
  assert.equal(parsed.success, false);
});

test("terminal journal entries older than the replay window are pruned", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-prune-"));
  const path = join(root, "journal.json");
  const taskId = "33333333-3333-4333-8333-333333333333";
  const nonce = crypto.randomUUID();
  const old = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
  await writeFile(path, JSON.stringify({ version: 1, entries: {
    [taskId]: {
      taskId, deviceId: "legion", nonce, leaseId: "old-lease",
      status: "completed", updatedAt: old,
      result: { status: "completed", summary: "old" },
    },
  } }));
  const now = Date.now();
  const signed = await signEnvelope({
    version: 1, taskId, deviceId: "legion", nonce: crypto.randomUUID(),
    issuedAt: now, expiresAt: now + 60_000,
    task: remoteTaskSchema.parse({ repo: "trvny", goal: "again" }),
  }, SECRET);
  try {
    const claim = await new RemoteJournal(path).claim(signed, "new-lease");
    assert.equal(claim.kind, "claimed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
function runningState(taskId: string): RemoteTaskState {
  const now = new Date().toISOString();
  return {
    taskId, deviceId: "legion", status: "running",
    createdAt: now, updatedAt: now, heartbeatAt: now, cancelRequested: false,
  };
}

test("worker shutdown aborts an active remote executor", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-remote-shutdown-"));
  const now = Date.now();
  const signed = await signEnvelope({
    version: 1, taskId: "44444444-4444-4444-8444-444444444444",
    deviceId: "legion", nonce: crypto.randomUUID(), issuedAt: now, expiresAt: now + 60_000,
    task: remoteTaskSchema.parse({ repo: "trvny", goal: "wait" }),
  }, SECRET);
  let delivered = false;
  process.env.PET_TEST_QUEUE_TOKEN = "queue-token";
  process.env.PET_TEST_SIGNING_SECRET = SECRET;
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/pull")) {
      if (delivered) return Response.json({ success: true, result: { messages: [] } });
      delivered = true;
      return Response.json({ success: true, result: { messages: [{ lease_id: "lease-shutdown", body: signed }] } });
    }
    if (url.pathname.endsWith("/messages/ack")) {
      return Response.json({ success: true, result: { ackCount: 1, retryCount: 0 } });
    }
    if (url.pathname.endsWith("/lease")) return Response.json(runningState(signed.envelope.taskId));
    if (url.pathname.endsWith("/result")) return Response.json(runningState(signed.envelope.taskId));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const executor: RemoteTaskExecutor = {
    execute(_task, _taskId, signal) {
      return new Promise((resolve, reject) => {
        if (!signal) return reject(new Error("missing abort signal"));
        if (signal.aborted) return resolve({ status: "failed", summary: "shutdown propagated" });
        signal.addEventListener("abort", () => {
          resolve({ status: "failed", summary: "shutdown propagated" });
        }, { once: true });
      });
    },
  };
  try {
    const config = transportConfig(join(root, "journal.json"));
    const worker = new RemoteWorker(new CloudflareQueueTransport(config, fakeFetch), new RemoteJournal(config.journalPath), executor);
    const controller = new AbortController();
    const polling = worker.pollOnce(controller.signal);
    setTimeout(() => controller.abort(new Error("test shutdown")), 10);
    assert.equal(await polling, true);
  } finally {
    delete process.env.PET_TEST_QUEUE_TOKEN;
    delete process.env.PET_TEST_SIGNING_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});


test("remote worker singleton lease rejects a second local worker", { skip: process.platform !== "win32" }, async () => {
  const key = `test:${crypto.randomUUID()}`;
  const first = await acquireRemoteWorkerLease(key);
  try {
    await assert.rejects(acquireRemoteWorkerLease(key), /already running/u);
  } finally {
    await first.close();
  }
  const replacement = await acquireRemoteWorkerLease(key);
  await replacement.close();
});
