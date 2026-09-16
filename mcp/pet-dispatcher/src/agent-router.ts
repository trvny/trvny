import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";
import type { RemoteCapability } from "./remote-protocol.js";
import { backendReadinessReason, OPENAI_COMPATIBLE_BACKENDS, OPENAI_COMPATIBLE_BACKEND_IDS } from "./openai-backends.js";


export type ProbeAvailability = "available" | "degraded" | "unavailable";
export type CostClass = "free" | "free-tier" | "unknown" | "metered";
export type ExecutorLifecycle = "active" | "planned";
export type ExecutorTaskKind = "direct" | "agent";
export type BackendMode = "none" | "fixed" | "managed" | "selectable";

export interface ProbeContext {
  env?: NodeJS.ProcessEnv;
  findCommand?: (command: string) => Promise<string | undefined>;
}

export interface ModelBackendProbe {
  id: string;
  availability: ProbeAvailability;
  costClass: CostClass;
  priority: number;
  reason?: string;
}

export interface ExecutorProbe {
  id: string;
  availability: ProbeAvailability;
  costClass: CostClass;
  priority: number;
  lifecycle: ExecutorLifecycle;
  implementation: ExecutorAdapter["implementation"];
  backendMode: BackendMode;
  backendIds: readonly string[];
  taskKinds: readonly ExecutorTaskKind[];
  capabilities: readonly RemoteCapability[];
  reason?: string;
}
export interface ModelBackend {
  id: string;
  authEnv: readonly string[];
  costClass: CostClass;
  priority: number;
  probe(context?: ProbeContext): Promise<ModelBackendProbe>;
}

export interface ExecutorAdapter {
  id: string;
  lifecycle: ExecutorLifecycle;
  implementation: "direct" | "embedded" | "cli";
  backendMode: BackendMode;
  backendIds: readonly string[];
  taskKinds: readonly ExecutorTaskKind[];
  capabilities: readonly RemoteCapability[];
  costClass: CostClass;
  priority: number;
  command?: string;
  probe(context?: ProbeContext): Promise<ExecutorProbe>;
}

export async function findCommandOnPath(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(command)) {
    throw new Error("command must be a safe command basename");
  }
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = process.platform === "win32" && !extname(command)
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const entry of pathValue.split(delimiter).filter(Boolean)) {
    const directory = entry.replace(/^"|"$/gu, "");
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        const metadata = await stat(candidate);
        if (!metadata.isFile()) continue;
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return await realpath(candidate);
      } catch { /* keep searching */ }
    }
  }
  return undefined;
}

function configured(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.some((name) => Boolean(env[name]));
}

type BackendDefinition = Omit<ModelBackend, "probe"> & { readiness?: (env: NodeJS.ProcessEnv) => string | undefined };

function backend(definition: BackendDefinition): ModelBackend {
  const { readiness, ...publicDefinition } = definition;
  return {
    ...publicDefinition,
    async probe(context = {}) {
      const env = context.env ?? process.env;
      const hasAuth = configured(env, definition.authEnv);
      const readinessReason = hasAuth ? readiness?.(env) : undefined;
      return {
        id: definition.id,
        availability: !hasAuth ? "unavailable" : readinessReason ? "degraded" : "available",
        costClass: definition.costClass,
        priority: definition.priority,
        reason: !hasAuth ? `missing auth env: ${definition.authEnv.join(" or ")}` : readinessReason,
      };
    },
  };
}

export const MODEL_BACKENDS: readonly ModelBackend[] = [
  ...OPENAI_COMPATIBLE_BACKENDS.map((definition) => backend({
    id: definition.id,
    authEnv: [definition.credentialEnv],
    costClass: definition.costClass,
    priority: definition.priority,
    readiness: (env) => backendReadinessReason(definition, env),
  })),
  backend({ id: "gemini", authEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], costClass: "free-tier", priority: 60 }),
];
const AGENT_CAPABILITIES = [
  "workspace.read", "workspace.write", "process.exec", "git.read",
  "git.commit", "tests.run", "network.fetch",
] as const satisfies readonly RemoteCapability[];
const DIRECT_CAPABILITIES = [
  "workspace.read", "workspace.write", "process.exec", "git.read", "git.commit",
] as const satisfies readonly RemoteCapability[];

function executorProbe(adapter: ExecutorAdapter, availability: ProbeAvailability, reason?: string): ExecutorProbe {
  return {
    id: adapter.id,
    availability,
    costClass: adapter.costClass,
    priority: adapter.priority,
    lifecycle: adapter.lifecycle,
    implementation: adapter.implementation,
    backendMode: adapter.backendMode,
    backendIds: adapter.backendIds,
    taskKinds: adapter.taskKinds,
    capabilities: adapter.capabilities,
    reason,
  };
}

function embeddedExecutor(definition: Omit<ExecutorAdapter, "probe">): ExecutorAdapter {
  return {
    ...definition,
    async probe(context = {}) {
      const targets = definition.backendIds.map((backendId) => MODEL_BACKENDS.find((item) => item.id === backendId));
      if (targets.some((target) => !target)) {
        const missing = definition.backendIds.find((backendId) => !MODEL_BACKENDS.some((item) => item.id === backendId));
        return executorProbe(this, "degraded", `unknown backend: ${missing ?? "none"}`);
      }
      const results = await Promise.all(targets.map((target) => target!.probe(context)));
      const available = results.find((result) => result.availability === "available");
      if (available) return executorProbe(this, "available");
      const degraded = results.find((result) => result.availability === "degraded");
      return executorProbe(this, degraded ? "degraded" : "unavailable", degraded?.reason ?? results[0]?.reason);
    },
  };
}
function cliExecutor(definition: Omit<ExecutorAdapter, "probe"> & { command: string }): ExecutorAdapter {
  return {
    ...definition,
    async probe(context = {}) {
      const env = context.env ?? process.env;
      const findCommand = context.findCommand ?? ((command: string) => findCommandOnPath(command, env));
      try {
        const found = await findCommand(definition.command);
        return executorProbe(this, found ? "available" : "unavailable", found ? undefined : `command not found: ${definition.command}`);
      } catch {
        return executorProbe(this, "degraded", "command probe failed");
      }
    },
  };
}

export const EXECUTOR_ADAPTERS: readonly ExecutorAdapter[] = [
  { id: "direct", lifecycle: "active", implementation: "direct", backendMode: "none", backendIds: [],
    taskKinds: ["direct"], capabilities: DIRECT_CAPABILITIES, costClass: "free", priority: 0,
    async probe() { return executorProbe(this, "available"); } },
  embeddedExecutor({ id: "openrouter", lifecycle: "active", implementation: "embedded", backendMode: "selectable", backendIds: OPENAI_COMPATIBLE_BACKEND_IDS,
    taskKinds: ["agent"], capabilities: AGENT_CAPABILITIES, costClass: "free-tier", priority: 10 }),
  embeddedExecutor({ id: "gemini", lifecycle: "active", implementation: "embedded", backendMode: "fixed", backendIds: ["gemini"],
    taskKinds: ["agent"], capabilities: AGENT_CAPABILITIES, costClass: "free-tier", priority: 20 }),
  cliExecutor({ id: "hermes", lifecycle: "planned", implementation: "cli", backendMode: "selectable", backendIds: [],
    taskKinds: ["agent"], capabilities: [], costClass: "unknown", priority: 30, command: "hermes" }),
  cliExecutor({ id: "opencode", lifecycle: "planned", implementation: "cli", backendMode: "selectable", backendIds: [],
    taskKinds: ["agent"], capabilities: [], costClass: "unknown", priority: 40, command: "opencode" }),
  cliExecutor({ id: "copilot", lifecycle: "planned", implementation: "cli", backendMode: "managed", backendIds: [],
    taskKinds: ["agent"], capabilities: [], costClass: "unknown", priority: 50, command: "copilot" }),
  cliExecutor({ id: "vibe", lifecycle: "planned", implementation: "cli", backendMode: "managed", backendIds: [],
    taskKinds: ["agent"], capabilities: [], costClass: "unknown", priority: 60, command: "vibe" }),
  cliExecutor({ id: "codex", lifecycle: "planned", implementation: "cli", backendMode: "managed", backendIds: [],
    taskKinds: ["agent"], capabilities: [], costClass: "unknown", priority: 70, command: "codex" }),
];

export async function probeModelBackends(context: ProbeContext = {}): Promise<ModelBackendProbe[]> {
  return Promise.all(MODEL_BACKENDS.map((backend) => backend.probe(context)));
}

export async function probeExecutorAdapters(context: ProbeContext = {}): Promise<ExecutorProbe[]> {
  return Promise.all(EXECUTOR_ADAPTERS.map((adapter) => adapter.probe(context)));
}

const availabilityRank: Record<ProbeAvailability, number> = { available: 0, degraded: 1, unavailable: 2 };
const costRank: Record<CostClass, number> = { free: 0, "free-tier": 1, unknown: 2, metered: 3 };

export function rankModelBackendProbes<T extends ModelBackendProbe>(probes: readonly T[]): T[] {
  return [...probes].sort((left, right) =>
    availabilityRank[left.availability] - availabilityRank[right.availability]
    || costRank[left.costClass] - costRank[right.costClass]
    || left.priority - right.priority
    || left.id.localeCompare(right.id));
}
export function rankExecutorProbes<T extends ExecutorProbe>(
  probes: readonly T[],
  options: { taskKind: ExecutorTaskKind; includePlanned?: boolean; includeNonAvailable?: boolean },
): T[] {
  return probes
    .filter((probe) => probe.taskKinds.includes(options.taskKind))
    .filter((probe) => options.includePlanned || probe.lifecycle === "active")
    .filter((probe) => options.includeNonAvailable || probe.availability === "available")
    .sort((left, right) =>
      availabilityRank[left.availability] - availabilityRank[right.availability]
      || costRank[left.costClass] - costRank[right.costClass]
      || left.priority - right.priority
      || left.id.localeCompare(right.id));
}

export async function probeRouting(context: ProbeContext = {}) {
  const [executors, backends] = await Promise.all([
    probeExecutorAdapters(context),
    probeModelBackends(context),
  ]);
  const rankedBackends = rankModelBackendProbes(backends);
  return {
    executors: [
      ...rankExecutorProbes(executors, { taskKind: "direct", includePlanned: true, includeNonAvailable: true }),
      ...rankExecutorProbes(executors, { taskKind: "agent", includePlanned: true, includeNonAvailable: true }),
    ],
    backends: rankedBackends,
    preferred: {
      direct: rankExecutorProbes(executors, { taskKind: "direct" }).map(({ id }) => id),
      agent: rankExecutorProbes(executors, { taskKind: "agent" }).map(({ id }) => id),
      backends: rankedBackends.filter(({ availability }) => availability === "available").map(({ id }) => id),
    },
  };
}
