import { z } from "zod";

export const remoteCapabilitySchema = z.enum([
  "workspace.read",
  "workspace.write",
  "process.exec",
  "git.read",
  "git.commit",
  "tests.run",
  "network.fetch",
  "adb.inspect",
  "adb.install",
  "github.pr.create",
]);

export const remoteNetworkSchema = z.object({
  mode: z.enum(["none", "brokered"]).default("none"),
  profile: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "none" && value.profile) {
    ctx.addIssue({ code: "custom", message: "network profile is invalid when mode is none" });
  }
  if (value.mode === "brokered" && !value.profile) {
    ctx.addIssue({ code: "custom", message: "brokered network mode requires a profile" });
  }
});

const remoteSessionIdSchema = z.string().uuid();

export const remoteDirectCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("session.open"), ttlMinutes: z.number().int().min(1).max(60).default(30) }).strict(),
  z.object({ tool: z.literal("session.close"), sessionId: remoteSessionIdSchema, discard: z.boolean().default(false) }).strict(),
  z.object({ tool: z.literal("fs.list"), path: z.string().max(1_024).default("."), sessionId: remoteSessionIdSchema.optional() }).strict(),
  z.object({ tool: z.literal("fs.stat"), path: z.string().min(1).max(1_024), sessionId: remoteSessionIdSchema.optional() }).strict(),
  z.object({ tool: z.literal("fs.read"), path: z.string().min(1).max(1_024), sessionId: remoteSessionIdSchema.optional() }).strict(),
  z.object({ tool: z.literal("fs.write"), sessionId: remoteSessionIdSchema, path: z.string().min(1).max(1_024), content: z.string().max(65_536) }).strict(),
  z.object({ tool: z.literal("git.status"), sessionId: remoteSessionIdSchema.optional() }).strict(),
  z.object({
    tool: z.literal("git.diff"), sessionId: remoteSessionIdSchema.optional(),
    staged: z.boolean().default(false),
    paths: z.array(z.string().min(1).max(1_024)).max(64).default([]),
  }).strict(),
  z.object({ tool: z.literal("git.add"), sessionId: remoteSessionIdSchema, paths: z.array(z.string().min(1).max(1_024)).min(1).max(64) }).strict(),
  z.object({ tool: z.literal("git.commit"), sessionId: remoteSessionIdSchema, message: z.string().min(1).max(500) }).strict(),
]);

export type RemoteDirectCall = z.infer<typeof remoteDirectCallSchema>;

export const REMOTE_DIRECT_READ_CAPABILITIES = ["workspace.read", "git.read"] as const;
export const REMOTE_DIRECT_WRITE_CAPABILITIES = ["workspace.read", "workspace.write", "git.read", "git.commit"] as const;
const REMOTE_DIRECT_WRITE_TOOLS = new Set<RemoteDirectCall["tool"]>([
  "session.open", "session.close", "fs.write", "git.add", "git.commit",
]);

export function isRemoteDirectWriteTool(tool: RemoteDirectCall["tool"]): boolean {
  return REMOTE_DIRECT_WRITE_TOOLS.has(tool);
}

export const remoteTaskSchema = z.object({
  repo: z.string().min(1).max(128),
  baseRef: z.string().min(1).max(256).default("main"),
  goal: z.string().min(1).max(20_000).optional(),
  executor: z.enum(["openrouter", "gemini", "direct"]).default("openrouter"),
  direct: remoteDirectCallSchema.optional(),
  profile: z.enum(["inspect", "code", "android", "publish"]).default("code"),
  capabilities: z.array(remoteCapabilitySchema).max(16).default([]),
  network: remoteNetworkSchema.default({ mode: "none" }),
  timeoutMinutes: z.number().int().min(1).max(20).default(20),
}).strict().superRefine((task, ctx) => {
  if (task.executor === "direct") {
    if (!task.direct) ctx.addIssue({ code: "custom", path: ["direct"], message: "direct executor requires a direct tool call" });
    if (task.goal) ctx.addIssue({ code: "custom", path: ["goal"], message: "direct executor does not accept a goal" });
    const tool = task.direct?.tool;
    const writeTool = tool ? isRemoteDirectWriteTool(tool) : false;
    const allowedCapabilities = writeTool ? REMOTE_DIRECT_WRITE_CAPABILITIES : REMOTE_DIRECT_READ_CAPABILITIES;
    const expectedProfile = writeTool ? "code" : "inspect";
    if (task.profile !== expectedProfile) ctx.addIssue({ code: "custom", path: ["profile"], message: `direct ${writeTool ? "write" : "read"} tools require the ${expectedProfile} profile` });
    for (const capability of task.capabilities) {
      if (!(allowedCapabilities as readonly string[]).includes(capability)) ctx.addIssue({ code: "custom", path: ["capabilities"], message: `capability is not allowed for direct tool calls: ${capability}` });
    }
    for (const capability of allowedCapabilities) {
      if (!task.capabilities.includes(capability)) ctx.addIssue({ code: "custom", path: ["capabilities"], message: `direct tools require capability: ${capability}` });
    }
    if (task.network.mode !== "none") ctx.addIssue({ code: "custom", path: ["network"], message: "direct tools require network mode none" });
    if (task.timeoutMinutes > 5) ctx.addIssue({ code: "custom", path: ["timeoutMinutes"], message: "direct tools are limited to five minutes" });
  } else {
    if (!task.goal) ctx.addIssue({ code: "custom", path: ["goal"], message: "agent executor requires a goal" });
    if (task.direct) ctx.addIssue({ code: "custom", path: ["direct"], message: "agent executor does not accept a direct tool call" });
  }
});

export type RemoteTask = z.infer<typeof remoteTaskSchema>;

export const taskEnvelopeSchema = z.object({
  version: z.literal(1),
  taskId: z.string().uuid(),
  deviceId: z.string().min(1).max(128),
  nonce: z.string().uuid(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  task: remoteTaskSchema,
});

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;

export const signedTaskEnvelopeSchema = z.object({
  envelope: taskEnvelopeSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});

export type SignedTaskEnvelope = z.infer<typeof signedTaskEnvelopeSchema>;
export const remoteResultSchema = z.object({
  status: z.enum(["completed", "failed", "cancelled", "recovery_required"]),
  summary: z.string().max(20_000),
  tests: z.string().max(20_000).optional(),
  diff: z.string().max(65_536).optional(),
  commit: z.string().regex(/^[0-9a-f]{40}$/u).optional(),
  exportedRef: z.string().max(256).optional(),
  output: z.string().max(65_536).optional(),
  error: z.string().max(4_096).optional(),
});

export type RemoteResult = z.infer<typeof remoteResultSchema>;

export const remoteTaskStateSchema = z.object({
  taskId: z.string().uuid(),
  deviceId: z.string().min(1).max(128),
  status: z.enum([
    "queued", "leased", "running", "cancel_requested",
    "completed", "failed", "cancelled", "recovery_required",
  ]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  heartbeatAt: z.string().datetime().optional(),
  cancelRequested: z.boolean().default(false),
  result: remoteResultSchema.optional(),
});

export type RemoteTaskState = z.infer<typeof remoteTaskStateSchema>;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("remote signing secret must be at least 32 characters");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signEnvelope(envelope: TaskEnvelope, secret: string): Promise<SignedTaskEnvelope> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalJson(envelope)),
  );
  return { envelope, signature: base64Url(new Uint8Array(signature)) };
}

export async function verifyEnvelope(signed: SignedTaskEnvelope, secret: string): Promise<boolean> {
  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signed.signature),
    new TextEncoder().encode(canonicalJson(signed.envelope)),
  );
}
function requestPayload(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, body].join("\n");
}

export async function signWorkerRequest(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(requestPayload(method, path, timestamp, nonce, body)),
  );
  return base64Url(new Uint8Array(signature));
}

export async function verifyWorkerRequest(
  secret: string,
  signature: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(signature)) return false;
  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    new TextEncoder().encode(requestPayload(method, path, timestamp, nonce, body)),
  );
}

export function validateEnvelopeFreshness(
  signed: SignedTaskEnvelope,
  expectedDeviceId: string,
  now = Date.now(),
): void {
  const { envelope } = signed;
  if (envelope.deviceId !== expectedDeviceId) throw new Error("remote task targets a different device");
  if (envelope.issuedAt > now + 5 * 60_000) throw new Error("remote task issuedAt is too far in the future");
  if (envelope.expiresAt <= now) throw new Error("remote task envelope has expired");
  if (envelope.expiresAt - envelope.issuedAt > 24 * 60 * 60_000) {
    throw new Error("remote task envelope lifetime exceeds 24 hours");
  }
}