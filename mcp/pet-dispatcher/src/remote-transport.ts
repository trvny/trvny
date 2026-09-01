import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { DispatcherConfig } from "./config.js";
import {
  remoteResultSchema,
  remoteTaskStateSchema,
  signedTaskEnvelopeSchema,
  signWorkerRequest,
  validateEnvelopeFreshness,
  verifyEnvelope,
  type RemoteResult,
  type RemoteTask,
  type SignedTaskEnvelope,
} from "./remote-protocol.js";

const terminalStatuses = new Set(["completed", "failed", "cancelled", "recovery_required"]);

const pulledMessageSchema = z.object({
  lease_id: z.string().min(1),
  body: z.unknown(),
}).passthrough();

const pullResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    messages: z.array(pulledMessageSchema),
  }).passthrough(),
}).passthrough();

const journalEntrySchema = z.object({
  taskId: z.string().uuid(),
  deviceId: z.string().min(1),
  nonce: z.string().uuid(),
  leaseId: z.string().min(1),
  status: z.enum(["leased", "running", "completed", "failed", "cancelled", "recovery_required"]),
  updatedAt: z.string().datetime(),
  result: remoteResultSchema.optional(),
});

const journalSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), journalEntrySchema),
});

type JournalEntry = z.infer<typeof journalEntrySchema>;
type JournalData = z.infer<typeof journalSchema>;

type PullMessage = z.infer<typeof pulledMessageSchema>;

type RemoteConfig = NonNullable<DispatcherConfig["remote"]>;

type ClaimResult =
  | { kind: "claimed"; entry: JournalEntry }
  | { kind: "terminal"; entry: JournalEntry };

export class RemoteJournal {
  #data?: JournalData;

  constructor(readonly path: string) {}

  async #load(): Promise<JournalData> {
    if (this.#data) return this.#data;
    try {
      this.#data = journalSchema.parse(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#data = { version: 1, entries: {} };
    }
    return this.#data;
  }

  async #save(): Promise<void> {
    const data = await this.#load();
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.path);
  }

  async claim(signed: SignedTaskEnvelope, leaseId: string): Promise<ClaimResult> {
    const data = await this.#load();
    const { taskId, deviceId, nonce } = signed.envelope;
    const existing = data.entries[taskId];
    if (existing) {
      if (terminalStatuses.has(existing.status)) return { kind: "terminal", entry: existing };
      existing.status = "recovery_required";
      existing.updatedAt = new Date().toISOString();
      existing.result = {
        status: "recovery_required",
        summary: "An earlier worker stopped before this task reached a terminal state.",
        error: "automatic task replay is disabled",
      };
      await this.#save();
      return { kind: "terminal", entry: existing };
    }

    const replay = Object.values(data.entries).find((entry) => entry.nonce === nonce && entry.taskId !== taskId);
    if (replay) throw new Error("remote task nonce was already used by another task");

    const entry: JournalEntry = {
      taskId, deviceId, nonce, leaseId,
      status: "leased", updatedAt: new Date().toISOString(),
    };
    data.entries[taskId] = entry;
    await this.#save();
    return { kind: "claimed", entry };
  }
  async mark(taskId: string, status: JournalEntry["status"], result?: RemoteResult): Promise<JournalEntry> {
    const data = await this.#load();
    const entry = data.entries[taskId];
    if (!entry) throw new Error(`remote journal has no task: ${taskId}`);
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    entry.result = result;
    await this.#save();
    return entry;
  }

  async recoverInterrupted(): Promise<JournalEntry[]> {
    const data = await this.#load();
    const recovered: JournalEntry[] = [];
    for (const entry of Object.values(data.entries)) {
      if (entry.status !== "leased" && entry.status !== "running") continue;
      entry.status = "recovery_required";
      entry.updatedAt = new Date().toISOString();
      entry.result = {
        status: "recovery_required",
        summary: "The local worker restarted while this task was active.",
        error: "manual recovery is required before any side effect can be replayed",
      };
      recovered.push(entry);
    }
    if (recovered.length) await this.#save();
    return recovered;
  }
}

export class CloudflareQueueTransport {
  readonly #queueToken: string;
  readonly #signingSecret: string;

  constructor(readonly config: RemoteConfig, readonly fetcher: typeof fetch = fetch) {
    this.#queueToken = process.env[config.queueTokenEnv] ?? "";
    this.#signingSecret = process.env[config.signingSecretEnv] ?? "";
    if (!this.#queueToken) throw new Error(`${config.queueTokenEnv} is required for remote queue access`);
    if (this.#signingSecret.length < 32) {
      throw new Error(`${config.signingSecretEnv} must contain at least 32 characters`);
    }
  }

  #queueUrl(suffix: string): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/queues/${this.config.queueId}/messages${suffix}`;
  }

  async #queueRequest(suffix: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(this.#queueUrl(suffix), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#queueToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error(`Cloudflare Queue request failed with HTTP ${response.status}`);
    return payload;
  }

  async pull(): Promise<PullMessage | undefined> {
    const payload = pullResponseSchema.parse(await this.#queueRequest("/pull", {
      batch_size: 1,
      visibility_timeout_ms: this.config.visibilityTimeoutMs,
    }));
    return payload.result.messages[0];
  }

  async ack(leaseId: string): Promise<void> {
    await this.#queueRequest("/ack", { acks: [{ lease_id: leaseId }], retries: [] });
  }

  async retry(leaseId: string, delaySeconds = 60): Promise<void> {
    await this.#queueRequest("/ack", {
      acks: [],
      retries: [{ lease_id: leaseId, delay_seconds: delaySeconds }],
    });
  }

  async decode(message: PullMessage, now = Date.now()): Promise<SignedTaskEnvelope> {
    const body = typeof message.body === "string" ? JSON.parse(message.body) as unknown : message.body;
    const signed = signedTaskEnvelopeSchema.parse(body);
    if (!await verifyEnvelope(signed, this.#signingSecret)) throw new Error("remote task signature is invalid");
    validateEnvelopeFreshness(signed, this.config.deviceId, now);
    return signed;
  }

  async report(taskId: string, action: "lease" | "heartbeat" | "result", payload: unknown): Promise<unknown> {
    const base = new URL(this.config.controlPlaneUrl);
    const path = `/v1/worker/tasks/${taskId}/${action}`;
    const target = new URL(path, base);
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const signature = await signWorkerRequest(
      this.#signingSecret, "POST", path, timestamp, nonce, body,
    );
    const response = await this.fetcher(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pet-device": this.config.deviceId,
        "x-pet-timestamp": timestamp,
        "x-pet-nonce": nonce,
        "x-pet-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Pet Dispatcher control plane returned HTTP ${response.status}`);
    return response.json();
  }
}

export interface RemoteTaskExecutor {
  execute(task: RemoteTask, taskId: string, signal?: AbortSignal): Promise<RemoteResult>;
}

export class RemoteWorker {
  constructor(
    readonly transport: CloudflareQueueTransport,
    readonly journal: RemoteJournal,
    readonly executor: RemoteTaskExecutor,
  ) {}

  async recover(): Promise<void> {
    for (const entry of await this.journal.recoverInterrupted()) {
      if (entry.result) await this.transport.report(entry.taskId, "result", entry.result);
      await this.transport.ack(entry.leaseId).catch(() => undefined);
    }
  }

  async pollOnce(): Promise<boolean> {
    const message = await this.transport.pull();
    if (!message) return false;

    let signed: SignedTaskEnvelope;
    try {
      signed = await this.transport.decode(message);
    } catch (error) {
      await this.transport.ack(message.lease_id);
      throw error;
    }

    const claim = await this.journal.claim(signed, message.lease_id);
    if (claim.kind === "terminal") {
      if (claim.entry.result) await this.transport.report(claim.entry.taskId, "result", claim.entry.result);
      await this.transport.ack(message.lease_id);
      return true;
    }

    const taskId = signed.envelope.taskId;
    await this.journal.mark(taskId, "running");
    const leaseState = remoteTaskStateSchema.parse(
      await this.transport.report(taskId, "lease", { status: "running" }),
    );
    if (leaseState.cancelRequested) {
      const result: RemoteResult = { status: "cancelled", summary: "Task was cancelled before local execution began." };
      await this.journal.mark(taskId, "cancelled", result);
      await this.transport.report(taskId, "result", result);
      await this.transport.ack(message.lease_id);
      return true;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error("remote task timeout exceeded"));
    }, signed.envelope.task.timeoutMinutes * 60_000);
    const heartbeatIntervalMs = this.transport.config.heartbeatIntervalMs;
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || controller.signal.aborted) return;
      heartbeatBusy = true;
      void this.transport.report(taskId, "heartbeat", { status: "running" })
        .then((value) => {
          const state = remoteTaskStateSchema.parse(value);
          if (state.cancelRequested && !controller.signal.aborted) {
            controller.abort(new Error("remote task cancellation requested"));
          }
        })
        .catch(() => undefined)
        .finally(() => { heartbeatBusy = false; });
    }, heartbeatIntervalMs);
    try {
      const result = remoteResultSchema.parse(
        await this.executor.execute(signed.envelope.task, taskId, controller.signal),
      );
      await this.journal.mark(taskId, result.status, result);
      await this.transport.report(taskId, "result", result);
      await this.transport.ack(message.lease_id);
      return true;
    } catch (error) {
      const result: RemoteResult = {
        status: "recovery_required",
        summary: "Remote task stopped after the local claim was persisted.",
        error: error instanceof Error ? error.message.slice(0, 4_096) : String(error).slice(0, 4_096),
      };
      await this.journal.mark(taskId, "recovery_required", result);
      await this.transport.report(taskId, "result", result).catch(() => undefined);
      await this.transport.ack(message.lease_id);
      return true;
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
    }
  }

  async run(signal?: AbortSignal): Promise<void> {
    await this.recover();
    while (!signal?.aborted) {
      const handled = await this.pollOnce();
      if (!handled) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.transport.config.pollIntervalMs));
      }
    }
  }
}