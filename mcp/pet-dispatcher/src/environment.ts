import { mkdir, realpath } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { DispatcherConfig } from "./config.js";
import type { Session } from "./sessions.js";

export interface PreparedSandboxEnvironment {
  env: NodeJS.ProcessEnv;
  readonlyRoots: string[];
  readwriteRoots: string[];
}

function expandWindowsVariables(value: string, hostEnv: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/gu, (match, name: string) => hostEnv[name] ?? hostEnv[name.toUpperCase()] ?? match);
}

function hostValue(hostEnv: NodeJS.ProcessEnv, name: string): string | undefined {
  return hostEnv[name] ?? hostEnv[name.toUpperCase()] ?? hostEnv[name.toLowerCase()];
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
  const appData = join(runtime, "appdata");
  const localAppData = join(runtime, "localappdata");
  const cache = join(runtime, "cache");
  const npmCache = join(cache, "npm");
  const gradleCache = join(cache, "gradle");
  const nugetCache = join(cache, "nuget");
  await Promise.all([home, temp, appData, localAppData, npmCache, gradleCache, nugetCache].map((path) => mkdir(path, { recursive: true })));

  const env: NodeJS.ProcessEnv = {
    PATH: [...new Set(toolRoots)].join(delimiter), HOME: home, USERPROFILE: home,
    TEMP: temp, TMP: temp, APPDATA: appData, LOCALAPPDATA: localAppData,
    NPM_CONFIG_CACHE: npmCache, GRADLE_USER_HOME: gradleCache, NUGET_PACKAGES: nugetCache,
  };
  for (const name of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"] as const) {
    const value = hostValue(hostEnv, name); if (value) env[name] = value;
  }
  const policy = config.environmentPolicy;
  const secretPattern = policy ? new RegExp(policy.secretNamePattern, "iu") : undefined;
  const allowedSecrets = new Set(session.network.profile ? policy?.networkProfileSecrets[session.network.profile] ?? [] : []);
  for (const name of policy?.sandboxPassthrough ?? []) {
    if (secretPattern?.test(name) && !allowedSecrets.has(name)) continue;
    const value = hostValue(hostEnv, name);
    if (value) env[name] = expandWindowsVariables(value, hostEnv);
  }
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
