import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hostRule = z.string().min(1)
  .regex(/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/, "network host rules must be exact DNS names");
const networkProfileSchema = z.object({ hosts: z.array(hostRule).min(1).max(64) });
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, "environment variable names must be portable identifiers");
const regexPattern = z.string().min(1).max(512).refine((value) => {
  try { new RegExp(value, "iu"); return true; } catch { return false; }
}, "secretNamePattern must be a valid regular expression");
const environmentPolicySchema = z.object({
  secretNamePattern: regexPattern,
  sandboxPassthrough: z.array(envName).max(128).default([]),
  sandboxReadonlyPathVariables: z.array(envName).max(64).default([]),
  networkProfileSecrets: z.record(z.string(), z.array(envName).max(32)).default({}),
}).strict();
export type EnvironmentPolicy = z.infer<typeof environmentPolicySchema>;

const DEFAULT_RESOURCE_LIMITS = {
  defaultMemoryMiB: 2_048,
  maxMemoryMiB: 6_144,
  defaultProcessCount: 32,
  maxProcessCount: 64,
  watchdogIntervalMs: 250,
} as const;

const resourceLimitsSchema = z.object({
  defaultMemoryMiB: z.number().int().min(256).max(6_144).default(DEFAULT_RESOURCE_LIMITS.defaultMemoryMiB),
  maxMemoryMiB: z.number().int().min(512).max(6_144).default(DEFAULT_RESOURCE_LIMITS.maxMemoryMiB),
  defaultProcessCount: z.number().int().min(1).max(64).default(DEFAULT_RESOURCE_LIMITS.defaultProcessCount),
  maxProcessCount: z.number().int().min(1).max(64).default(DEFAULT_RESOURCE_LIMITS.maxProcessCount),
  watchdogIntervalMs: z.number().int().min(100).max(5_000).default(DEFAULT_RESOURCE_LIMITS.watchdogIntervalMs),
}).superRefine((value, ctx) => {
  if (value.defaultMemoryMiB > value.maxMemoryMiB) ctx.addIssue({ code: "custom", path: ["defaultMemoryMiB"], message: "default memory limit may not exceed the maximum" });
  if (value.defaultProcessCount > value.maxProcessCount) ctx.addIssue({ code: "custom", path: ["defaultProcessCount"], message: "default process limit may not exceed the maximum" });
}).default(DEFAULT_RESOURCE_LIMITS);

const remoteSchema = z.object({
  enabled: z.boolean().default(false), deviceId: z.string().min(1).max(128), accountId: z.string().regex(/^[0-9a-f]{32}$/u),
  queueId: z.string().regex(/^[0-9a-f]{32}$/u),
  controlPlaneUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "controlPlaneUrl must use HTTPS"),
  queueTokenEnv: z.string().min(1).default("PET_DISPATCHER_QUEUE_TOKEN"),
  signingSecretEnv: z.string().min(1).default("PET_DISPATCHER_SIGNING_SECRET"),
  pollIntervalMs: z.number().int().min(1_000).max(60_000).default(5_000),
  pollMaxIntervalMs: z.number().int().min(1_000).max(300_000).default(60_000),
  heartbeatIntervalMs: z.number().int().min(5_000).max(60_000).default(15_000),
  visibilityTimeoutMs: z.number().int().min(1_800_000).max(43_200_000).default(1_800_000),
  syncRepositories: z.boolean().default(true),
  journalPath: z.string().min(1).default("remote-journal.json"),
}).superRefine((value, ctx) => {
  if (value.pollMaxIntervalMs < value.pollIntervalMs) {
    ctx.addIssue({ code: "custom", path: ["pollMaxIntervalMs"], message: "maximum poll interval may not be lower than the base interval" });
  }
});

const configSchema = z.object({
  workspaceRoot: z.string().min(1), repositories: z.record(z.string(), z.string().min(1)), workspaces: z.record(z.string(), z.string().min(1)).default({}),
  toolRoots: z.array(z.string().min(1)).default([]), networkProfiles: z.record(z.string(), networkProfileSchema).default({}),
  environmentPolicyPath: z.string().min(1).optional(),
  defaultTimeoutMs: z.number().int().min(1_000).max(3_600_000).default(120_000),
  maxOutputBytes: z.number().int().min(4_096).max(16_777_216).default(1_048_576), maxBrokerResponseBytes: z.number().int().min(1_024).max(8_388_608).default(2_097_152),
  sessionReaperIntervalMs: z.number().int().min(1_000).max(60_000).default(15_000), resourceLimits: resourceLimitsSchema,
  openRouterModel: z.string().min(1).default("openrouter/free"), geminiModel: z.string().min(1).default("gemini-2.5-flash"), remote: remoteSchema.optional(),
}).superRefine((value, ctx) => {
  for (const alias of Object.keys(value.workspaces)) if (alias in value.repositories) ctx.addIssue({ code: "custom", path: ["workspaces", alias], message: "workspace and repository aliases must be unique" });
});

type ParsedDispatcherConfig = z.infer<typeof configSchema>;
type ParsedRemoteConfig = NonNullable<ParsedDispatcherConfig["remote"]>;
export type DispatcherConfig = Omit<ParsedDispatcherConfig, "workspaces" | "sessionReaperIntervalMs" | "resourceLimits" | "remote"> & {
  environmentPolicy?: EnvironmentPolicy;
  workspaces?: ParsedDispatcherConfig["workspaces"];
  sessionReaperIntervalMs?: number;
  resourceLimits?: ParsedDispatcherConfig["resourceLimits"];
  remote?: Omit<ParsedRemoteConfig, "pollMaxIntervalMs"> & { pollMaxIntervalMs?: number };
};

function resolveLocalPath(value: string, base: string): string { return resolve(isAbsolute(value) ? value : resolve(base, value)); }

export async function loadConfig(configPath = process.env.PET_DISPATCHER_CONFIG): Promise<DispatcherConfig> {
  if (!configPath) throw new Error("PET_DISPATCHER_CONFIG must point to a local dispatcher config file");
  const absoluteConfigPath = resolve(configPath);
  const raw = JSON.parse(await readFile(absoluteConfigPath, "utf8")) as unknown;
  const parsed = configSchema.parse(raw);
  const base = dirname(absoluteConfigPath);
  const environmentPolicy = parsed.environmentPolicyPath
    ? environmentPolicySchema.parse(JSON.parse(await readFile(resolveLocalPath(parsed.environmentPolicyPath, base), "utf8")) as unknown)
    : undefined;
  return {
    ...parsed,
    workspaceRoot: resolveLocalPath(parsed.workspaceRoot, base),
    repositories: Object.fromEntries(Object.entries(parsed.repositories).map(([name, path]) => [name, resolveLocalPath(path, base)])),
    workspaces: Object.fromEntries(Object.entries(parsed.workspaces).map(([name, path]) => [name, resolveLocalPath(path, base)])),
    toolRoots: parsed.toolRoots.map((path) => resolveLocalPath(path, base)),
    environmentPolicy,
    remote: parsed.remote ? { ...parsed.remote, journalPath: resolveLocalPath(parsed.remote.journalPath, base) } : undefined,
    networkProfiles: Object.fromEntries(Object.entries(parsed.networkProfiles).map(([name, profile]) => [name, { hosts: [...new Set(profile.hosts.map((host) => host.toLowerCase()))] }])),
  };
}

export const moduleDir = dirname(fileURLToPath(import.meta.url));
