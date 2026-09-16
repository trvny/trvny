import { mkdir, realpath } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { DispatcherConfig } from "./config.js";
import type { Session } from "./sessions.js";

export interface PreparedSandboxEnvironment {
  env: NodeJS.ProcessEnv;
  readonlyRoots: string[];
  readwriteRoots: string[];
}

function hostValue(hostEnv: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = hostEnv[name] ?? hostEnv[name.toUpperCase()] ?? hostEnv[name.toLowerCase()];
  if (direct !== undefined) return direct;
  const wanted = name.toLowerCase();
  return Object.entries(hostEnv).find(([key]) => key.toLowerCase() === wanted)?.[1];
}

function expandWindowsVariables(value: string, allowedEnv: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/gu, (match, name: string) => hostValue(allowedEnv, name) ?? match);
}

export async function prepareSandboxEnvironment(
  config: DispatcherConfig,
  session: Session,
  toolRoots: readonly string[],
  hostEnv: NodeJS.ProcessEnv = process.env,
): Promise<PreparedSandboxEnvironment> {
  const runtime = join(session.sessionDir, "runtime");
  const home = join(runtime, "home");
  const temp = join(runtime, "tmp");
  const cache = join(runtime, "cache");
  const runtimeEnv = {
    HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp,
    APPDATA: join(runtime, "appdata"), LOCALAPPDATA: join(runtime, "localappdata"),
    NPM_CONFIG_CACHE: join(cache, "npm"), GRADLE_USER_HOME: join(cache, "gradle"), NUGET_PACKAGES: join(cache, "nuget"),
  };
  await Promise.all([...new Set(Object.values(runtimeEnv))].map((path) => mkdir(path, { recursive: true })));

  const env: NodeJS.ProcessEnv = { PATH: [...new Set(toolRoots)].join(delimiter), ...runtimeEnv };
  for (const name of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"] as const) {
    const value = hostValue(hostEnv, name); if (value) env[name] = value;
  }
  const policy = config.environmentPolicy;
  const secretPattern = policy ? new RegExp(policy.secretNamePattern, "iu") : undefined;
  const allowedSecrets = new Set(session.network.profile ? policy?.networkProfileSecrets[session.network.profile] ?? [] : []);
  const passthrough = new Map<string, string>();
  for (const name of policy?.sandboxPassthrough ?? []) {
    if (allowedSecrets.has(name) || secretPattern?.test(name)) continue;
    const value = hostValue(hostEnv, name);
    if (value) passthrough.set(name, value);
  }
  const expansionEnv: NodeJS.ProcessEnv = { ...env };
  for (const [name, value] of passthrough) {
    expansionEnv[name] = value;
    expansionEnv[name.toUpperCase()] = value;
  }
  for (const [name, value] of passthrough) env[name] = expandWindowsVariables(value, expansionEnv);
  for (const name of allowedSecrets) {
    const value = hostValue(hostEnv, name);
    if (value) env[name] = value;
  }

  const readonlyRoots: string[] = [];
  for (const name of policy?.sandboxReadonlyPathVariables ?? []) {
    const value = env[name];
    if (!value) continue;
    try { readonlyRoots.push(await realpath(value)); } catch { /* optional host SDK/tool is absent */ }
  }
  return {
    env,
    readonlyRoots: [...new Set(readonlyRoots)],
    readwriteRoots: [runtime],
  };
}
