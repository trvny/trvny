import { execFile, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, parse, relative, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { createConfigFromPolicy, getPlatformSupport, spawnSandboxFromConfig } from "@microsoft/mxc-sdk";
import { findCommandOnPath } from "./agent-router.js";
import type { DispatcherConfig } from "./config.js";
import { prepareSandboxEnvironment } from "./environment.js";
import { NetworkBroker, type SubprocessNetworkProxy } from "./network.js";
import { resolveExisting } from "./path-guard.js";
import type { Session, SessionManager } from "./sessions.js";
import { WindowsJobGuard, type JobGuardLimits, type JobGuardStats } from "./windows-job-guard.js";

const execFileAsync = promisify(execFile);

export interface ExecLimits { memoryMiB?: number; processLimit?: number }
export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  peakMemoryBytes?: number;
  killReason?: string | null;
  memoryLimitMiB?: number;
  processLimit?: number;
}

interface RunningProcess {
  child: ChildProcess;
  jobId: string;
  limits: Required<JobGuardLimits>;
  closed: Promise<void>;
  resolveClosed(): void;
  requestedKillReason: string | null;
}

const WINDOWS_EXTENSIONS = [".exe", ".com", ".cmd", ".bat", ""];

export function requiresSystemDrivePrep(
  warnings: readonly string[],
  aclReady?: boolean,
  platform = process.platform,
): boolean {
  if (platform === "win32" && aclReady !== undefined) return !aclReady;
  return warnings.some((warning) => warning.includes("prepare-system-drive") || warning.includes("system-drive root"));
}

let systemDrivePrepAclProbe: Promise<boolean | undefined> | undefined;

function probeSystemDrivePrepAcl(): Promise<boolean | undefined> {
  systemDrivePrepAclProbe ??= probeSystemDrivePrepAclUncached();
  return systemDrivePrepAclProbe;
}

async function probeSystemDrivePrepAclUncached(): Promise<boolean | undefined> {
  if (process.platform !== "win32") return undefined;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const driveRoot = parse(systemRoot).root;
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    `$target=${JSON.stringify(driveRoot)};`,
    "$want=@('S-1-15-2-1','S-1-15-2-2');",
    "$acl=([System.IO.DirectoryInfo]::new($target)).GetAccessControl();",
    "$aces=@($acl.GetAccessRules($true,$false,[System.Security.Principal.SecurityIdentifier]));",
    "$ok=$true; foreach($sid in $want){",
    "  $match=@($aces | Where-Object { $_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq 'Allow' -and [int64]$_.FileSystemRights -eq 0x00120088 -and $_.InheritanceFlags -eq 'None' -and $_.PropagationFlags -eq 'None' });",
    "  if($match.Count -eq 0){$ok=$false}",
    "}; if($ok){Write-Output 'ready'; exit 0}else{Write-Output 'missing'; exit 0}",
  ].join(" ");
  try {
    const { stdout } = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20_000 });
    return stdout.trim() === "ready";
  } catch {
    return false;
  }
}

function quoteBatchArg(value: string): string {
  if (/[\0\r\n"&|<>^%!]/u.test(value)) throw new Error("batch-file arguments may not contain cmd metacharacters");
  return `"${value}"`;
}

function quoteWindowsArg(value: string): string {
  if (value === "") return '""';
  if (!/[\s"]/u.test(value)) return value;
  let out = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") { slashes++; continue; }
    if (char === '"') out += `${"\\".repeat(slashes * 2 + 1)}"`;
    else out += `${"\\".repeat(slashes)}${char}`;
    slashes = 0;
  }
  return `${out}${"\\".repeat(slashes * 2)}"`;
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number, name: string, minimum: number): number {
  const selected = value ?? fallback;
  if (!Number.isFinite(selected) || !Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return selected;
}

function pathKey(value: string): string { return process.platform === "win32" ? value.toLowerCase() : value; }
function pathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function discoveredToolGrantRoot(executable: string, platform = process.platform): string {
  if (platform !== "win32") return dirname(executable);
  const normalized = win32.normalize(executable);
  const match = /^(.*?\\scoop\\apps\\[^\\]+\\[^\\]+)(?:\\|$)/iu.exec(normalized);
  return match?.[1] ?? win32.dirname(normalized);
}

export function allowWindowsForExecutable(hostTool: boolean, platform = process.platform): boolean {
  return platform === "win32" && hostTool;
}

export class CommandRunner {
  readonly #running = new Map<string, RunningProcess>();
  readonly #pathTools = new Map<string, Promise<string | undefined>>();
  readonly #networkBroker: NetworkBroker;

  private constructor(
    readonly config: DispatcherConfig,
    readonly sessions: SessionManager,
    readonly toolRoots: string[],
    readonly jobGuard: WindowsJobGuard | undefined,
    readonly systemDrivePrepRequired: boolean,
  ) { this.#networkBroker = new NetworkBroker(config); }

  static async create(config: DispatcherConfig, sessions: SessionManager): Promise<CommandRunner> {
    const support = getPlatformSupport();
    if (!support.isSupported) throw new Error(`MXC sandbox is unavailable: ${support.reason ?? "unsupported platform"}`);
    const roots = new Set<string>();
    const automatic = [process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : undefined, dirname(process.execPath)];
    for (const candidate of [...automatic, ...config.toolRoots]) {
      if (!candidate) continue;
      try { roots.add(await realpath(candidate)); } catch { /* unavailable local tool root */ }
    }
    const watchdogIntervalMs = config.resourceLimits?.watchdogIntervalMs ?? 250;
    const guard = await WindowsJobGuard.create(watchdogIntervalMs);
    if (process.platform === "win32" && !guard) throw new Error("Windows Job Object resource guardian is unavailable");
    const aclReady = await probeSystemDrivePrepAcl();
    const systemDrivePrepRequired = requiresSystemDrivePrep(support.isolationWarnings ?? [], aclReady);
    const runner = new CommandRunner(config, sessions, [...roots], guard, systemDrivePrepRequired);
    sessions.setProcessTerminator((sessionId) => runner.terminateSession(sessionId));
    return runner;
  }

  activeProcessCount(): number { return this.#running.size; }

  securityStatus(): object {
    const support = getPlatformSupport();
    const warnings = support.isolationWarnings ?? [];
    const systemDrivePrepRequired = this.systemDrivePrepRequired;
    const nullDevicePrepRequired = warnings.some((warning) => warning.includes("prepare-null-device") || warning.includes("\\Device\\Null"));
    const limits = this.config.resourceLimits;
    return {
      supported: support.isSupported,
      backend: support.availableMethods,
      isolationTier: support.isolationTier ?? null,
      warnings,
      hostPrep: {
        systemDrive: systemDrivePrepRequired ? "required" : "ready-or-not-needed",
        nullDevice: nullDevicePrepRequired ? "required" : "ready-or-not-needed",
        command: systemDrivePrepRequired ? "wxc-host-prep prepare-system-drive" : null,
      },
      networkDefault: "deny",
      networkModes: { none: true, brokered: true, restricted: false },
      childEnvironment: "cleared",
      uiPolicy: process.platform === "win32"
        ? { hostTools: "win32k-allowed", workspaceExecutables: "win32k-denied", clipboard: "deny", inputInjection: "deny" }
        : { hostTools: "backend-default", workspaceExecutables: "backend-default", clipboard: "deny", inputInjection: "deny" },
      configuredToolRoots: this.toolRoots.length,
      processGuard: process.platform === "win32" ? "windows-job-object" : "sandbox-backend",
      resourceLimits: {
        defaultMemoryMiB: limits?.defaultMemoryMiB ?? 2_048,
        maxMemoryMiB: limits?.maxMemoryMiB ?? 6_144,
        defaultProcessCount: limits?.defaultProcessCount ?? 32,
        maxProcessCount: limits?.maxProcessCount ?? 64,
      },
    };
  }

  async #discoverPathExecutable(command: string): Promise<string | undefined> {
    const key = pathKey(command);
    const existing = this.#pathTools.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const executable = await findCommandOnPath(command);
      if (!executable) return undefined;
      const root = await realpath(discoveredToolGrantRoot(executable));
      if (pathKey(root) === pathKey(parse(root).root)) throw new Error("refusing filesystem root as a discovered tool root");
      if (!this.toolRoots.some((item) => pathKey(item) === pathKey(root))) this.toolRoots.push(root);
      return executable;
    })().catch((error) => {
      this.#pathTools.delete(key);
      throw error;
    });
    this.#pathTools.set(key, pending);
    return pending;
  }

  async #resolveExecutable(session: Session, command: string): Promise<{ path: string; hostTool: boolean }> {
    if (!command || command.includes("\0")) throw new Error("command is required");
    if (command.includes("/") || command.includes("\\")) {
      const local = await resolveExisting(session.root, command);
      await access(local, constants.F_OK);
      return { path: local, hostTool: false };
    }
    for (const root of this.toolRoots) {
      for (const extension of WINDOWS_EXTENSIONS) {
        const candidate = resolve(root, command + extension);
        try {
          await access(candidate, constants.F_OK);
          const target = await realpath(candidate);
          if (pathInside(root, target)) return { path: target, hostTool: true };
        } catch { /* keep searching configured roots */ }
      }
    }
    const discovered = await this.#discoverPathExecutable(command);
    if (discovered) return { path: discovered, hostTool: true };
    throw new Error(`executable is outside configured tool roots and host PATH or missing: ${command}`);
  }

  #limits(requested: ExecLimits): Required<JobGuardLimits> {
    const configured = this.config.resourceLimits;
    const maxMemoryMiB = configured?.maxMemoryMiB ?? 6_144;
    const maxProcessCount = configured?.maxProcessCount ?? 64;
    return {
      memoryMiB: boundedLimit(requested.memoryMiB, configured?.defaultMemoryMiB ?? 2_048, maxMemoryMiB, "memoryMiB", 256),
      processLimit: boundedLimit(requested.processLimit, configured?.defaultProcessCount ?? 32, maxProcessCount, "processLimit", 1),
    };
  }

  async #fallbackTreeKill(child: ChildProcess): Promise<void> {
    if (!child.pid) { child.kill(); return; }
    if (process.platform === "win32") {
      const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      await execFileAsync(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 }).catch(() => undefined);
      return;
    }
    child.kill("SIGKILL");
  }

  async #killRunning(running: RunningProcess, reason: string): Promise<void> {
    if (!running.requestedKillReason) running.requestedKillReason = reason;
    let guarded = false;
    if (this.jobGuard) {
      try { await this.jobGuard.kill(running.jobId, reason); guarded = true; } catch { /* fallback below */ }
    }
    if (!guarded) await this.#fallbackTreeKill(running.child);
  }

  async terminateSession(sessionId: string, reason = "session_close"): Promise<boolean> {
    const running = this.#running.get(sessionId);
    if (!running) return false;
    await this.#killRunning(running, reason);
    await Promise.race([
      running.closed,
      new Promise<void>((resolveWait) => { const timer = setTimeout(resolveWait, 5_000); timer.unref(); }),
    ]);
    if (this.#running.get(sessionId) === running) await this.#fallbackTreeKill(running.child);
    return true;
  }

  async exec(sessionId: string, argv: string[], cwd = ".", timeoutMs?: number, signal?: AbortSignal, requestedLimits: ExecLimits = {}): Promise<ExecResult> {
    if (signal?.aborted) throw signal.reason ?? new Error("workspace exec aborted");
    if (argv.length === 0) throw new Error("argv must contain an executable");
    if (this.systemDrivePrepRequired) {
      throw new Error("workspace.exec unavailable: MXC system-drive host preparation is required; run elevated `wxc-host-prep prepare-system-drive`, then restart Pet Dispatcher");
    }
    const releaseActivity = this.sessions.acquireActivity(sessionId, "workspace.exec");
    let child: ChildProcess | undefined;
    let running: RunningProcess | undefined;
    let proxy: SubprocessNetworkProxy | undefined;
    let activityReleased = false;
    const release = () => { if (!activityReleased) { activityReleased = true; releaseActivity(); } };
    try {
      if (this.#running.has(sessionId)) throw new Error("session already has a running command");
      const session = this.sessions.get(sessionId);
      const workingDirectory = await resolveExisting(session.root, cwd);
      const resolvedExecutable = await this.#resolveExecutable(session, argv[0] ?? "");
      const executable = resolvedExecutable.path;
      const prepared = await prepareSandboxEnvironment(this.config, session, this.toolRoots);
      if (session.network.mode === "brokered" && session.network.profile) {
        proxy = await this.#networkBroker.openProxy(session);
        for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) prepared.env[name] = proxy.url;
      }
      if (signal?.aborted) throw signal.reason ?? new Error("workspace exec aborted");
      const requestedTimeout = timeoutMs ?? this.config.defaultTimeoutMs;
      if (!Number.isFinite(requestedTimeout) || requestedTimeout < 1_000) throw new Error("timeoutMs must be a finite value of at least 1000ms");
      const timeout = Math.min(Math.trunc(requestedTimeout), 3_600_000);
      const limits = this.#limits(requestedLimits);
      const extension = extname(executable).toLowerCase();
      let commandLine: string;
      if (extension === ".cmd" || extension === ".bat") {
        const cmd = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
        const inner = [executable, ...argv.slice(1)].map(quoteBatchArg).join(" ");
        commandLine = `${quoteWindowsArg(cmd)} /d /s /v:off /c "${inner}"`;
      } else commandLine = [executable, ...argv.slice(1)].map(quoteWindowsArg).join(" ");

      const networkPolicy = proxy ? {
        egress: { default: "deny" as const, allow: [{
          to: [{ cidr: "127.0.0.1/32" }], ports: [{ protocol: "tcp" as const, port: proxy.port }],
        }] },
        ingress: { default: "deny" as const, hostLoopback: "allow" as const },
      } : {
        egress: { default: "deny" as const },
        ingress: { default: "deny" as const, hostLoopback: "deny" as const },
      };
      const policy = {
        version: "0.8.0-alpha",
        filesystem: { readwritePaths: [session.root, ...prepared.readwriteRoots], readonlyPaths: [...this.toolRoots, ...session.readonlyRoots, ...prepared.readonlyRoots] },
        network: networkPolicy,
        ui: { allowWindows: allowWindowsForExecutable(resolvedExecutable.hostTool), clipboard: "none" as const, allowInputInjection: false },
        timeoutMs: timeout,
      };
      const sandbox = createConfigFromPolicy(policy, "process", `pet-dispatcher-${session.id}`);
      if (!sandbox.process) throw new Error("MXC did not create a process configuration");
      sandbox.process.commandLine = commandLine;
      sandbox.process.cwd = workingDirectory;
      const started = Date.now();
      child = spawnSandboxFromConfig(sandbox, { usePty: false }, workingDirectory, prepared.env);
      if (!child.pid) { await this.#fallbackTreeKill(child); throw new Error("MXC process started without a pid"); }
      const jobId = `${sessionId}:${started}`;
      if (this.jobGuard) {
        try { await this.jobGuard.attach(jobId, child.pid, limits); }
        catch (error) {
          await this.#fallbackTreeKill(child);
          throw new Error(`failed to attach process resource guard: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolvePromise) => { resolveClosed = resolvePromise; });
      running = { child, jobId, limits, closed, resolveClosed, requestedKillReason: null };
      this.#running.set(sessionId, running);
      const active = running;
      const abort = () => { void this.#killRunning(active, "cancelled"); };
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      const timeoutTimer = setTimeout(() => { void this.#killRunning(active, "timeout"); }, timeout);
      timeoutTimer.unref();

      const result = await new Promise<ExecResult>((resolveResult, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let truncated = false;
        let settled = false;
        const capture = (chunks: Buffer[], usedBytes: number, chunk: Buffer | string): number => {
          if (usedBytes >= this.config.maxOutputBytes) { truncated = true; return usedBytes; }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = this.config.maxOutputBytes - usedBytes;
          if (buffer.length <= remaining) { chunks.push(buffer); return usedBytes + buffer.length; }
          if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
          truncated = true; return this.config.maxOutputBytes;
        };
        child!.stdout?.on("data", (chunk: Buffer | string) => { stdoutBytes = capture(stdoutChunks, stdoutBytes, chunk); });
        child!.stderr?.on("data", (chunk: Buffer | string) => { stderrBytes = capture(stderrChunks, stderrBytes, chunk); });
        child!.once("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          signal?.removeEventListener("abort", abort);
          if (this.#running.get(sessionId) === active) this.#running.delete(sessionId);
          active.resolveClosed(); release();
          void this.jobGuard?.release(active.jobId).catch(() => undefined);
          reject(error);
        });
        child!.once("close", (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          signal?.removeEventListener("abort", abort);
          if (this.#running.get(sessionId) === active) this.#running.delete(sessionId);
          void (async () => {
            let stats: JobGuardStats | undefined;
            try { stats = await this.jobGuard?.release(active.jobId); } catch { /* bounded telemetry only */ }
            const memoryThreshold = active.limits.memoryMiB * 1_048_576 * 0.85;
            const killReason = stats?.killReason ?? active.requestedKillReason ?? ((exitCode ?? 0) !== 0 && (stats?.peakMemoryBytes ?? 0) >= memoryThreshold ? "memory_limit" : null);
            active.resolveClosed(); release();
            resolveResult({
              exitCode,
              stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8"),
              stderr: Buffer.concat(stderrChunks, stderrBytes).toString("utf8"),
              truncated,
              durationMs: Date.now() - started,
              peakMemoryBytes: stats?.peakMemoryBytes,
              killReason,
              memoryLimitMiB: active.limits.memoryMiB,
              processLimit: active.limits.processLimit,
            });
          })();
        });
      });
      if (signal?.aborted) throw signal.reason ?? new Error("workspace exec aborted");
      return result;
    } catch (error) {
      if (!running && child && this.jobGuard) await this.jobGuard.release(`${sessionId}:${Date.now()}`).catch(() => undefined);
      if (!running) release();
      throw error;
    } finally {
      await proxy?.close().catch(() => undefined);
    }
  }

  cancel(sessionId: string): boolean {
    const running = this.#running.get(sessionId);
    if (!running) return false;
    void this.#killRunning(running, "cancelled");
    return true;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#running.keys()].map((sessionId) => this.terminateSession(sessionId, "worker_shutdown").catch(() => false)));
    await this.jobGuard?.close();
  }
}
