import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hostRule = z.string().min(1)
  .regex(/^(?:\*\.)?[A-Za-z0-9.-]+$/, "network host rules must be DNS names or *.domain patterns")
  .refine((value) => !value.startsWith("*.") || value.slice(2).includes("."), "wildcard network host rules must include a multi-label domain suffix");
const networkProfileSchema = z.object({
  hosts: z.array(hostRule).min(1).max(64),
});

const configSchema = z.object({
  workspaceRoot: z.string().min(1),
  repositories: z.record(z.string(), z.string().min(1)),
  toolRoots: z.array(z.string().min(1)).default([]),
  networkProfiles: z.record(z.string(), networkProfileSchema).default({}),
  defaultTimeoutMs: z.number().int().min(1_000).max(3_600_000).default(120_000),
  maxOutputBytes: z.number().int().min(4_096).max(16_777_216).default(1_048_576),
  maxBrokerResponseBytes: z.number().int().min(1_024).max(8_388_608).default(2_097_152),
  openRouterModel: z.string().min(1).default("openrouter/free"),
  geminiModel: z.string().min(1).default("gemini-2.5-flash"),
});

export type DispatcherConfig = z.infer<typeof configSchema>;

function resolveLocalPath(value: string, base: string): string {
  return resolve(isAbsolute(value) ? value : resolve(base, value));
}
export async function loadConfig(configPath = process.env.PET_DISPATCHER_CONFIG): Promise<DispatcherConfig> {
  if (!configPath) throw new Error("PET_DISPATCHER_CONFIG must point to a local dispatcher config file");
  const absoluteConfigPath = resolve(configPath);
  const raw = JSON.parse(await readFile(absoluteConfigPath, "utf8")) as unknown;
  const parsed = configSchema.parse(raw);
  const base = dirname(absoluteConfigPath);
  return {
    ...parsed,
    workspaceRoot: resolveLocalPath(parsed.workspaceRoot, base),
    repositories: Object.fromEntries(
      Object.entries(parsed.repositories).map(([name, path]) => [name, resolveLocalPath(path, base)]),
    ),
    toolRoots: parsed.toolRoots.map((path) => resolveLocalPath(path, base)),
    networkProfiles: Object.fromEntries(
      Object.entries(parsed.networkProfiles).map(([name, profile]) => [
        name,
        { hosts: [...new Set(profile.hosts.map((host) => host.toLowerCase()))] },
      ]),
    ),
  };
}

export const moduleDir = dirname(fileURLToPath(import.meta.url));
