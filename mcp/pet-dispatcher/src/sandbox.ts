import { type ChildProcess } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { constants } from "node:fs";
import { createConfigFromPolicy, getPlatformSupport, spawnSandboxFromConfig } from "@microsoft/mxc-sdk";
import type { DispatcherConfig } from "./config.js";
import type { Session, SessionManager } from "./sessions.js";
import { resolveExisting } from "./path-guard.js";

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

const WINDOWS_EXTENSIONS = [".exe", ".com", ".cmd", ".bat", ""];

function quoteWindowsArg(value: string): string {
  if (value === "") return '""';
  if (!/[\s"]/u.test(value)) return value;
  let out = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") { slashes++; continue; }
    if (char === '"') out += "\\".repeat(slashes * 2 + 1) + '"';
    else out += "\\".repeat(slashes) + char;
    slashes = 0;
  }
  return out + "\\".repeat(slashes * 2) + '"';
}
export class CommandRunner {
  readonly #running = new Map<string, ChildProcess>();
  private constructor(
    readonly config: DispatcherConfig,
    readonly sessions: SessionManager,
    readonly toolRoots: string[],
  ) {}

  static async create(config: DispatcherConfig, sessions: SessionManager): Promise<CommandRunner> {
    const support = getPlatformSupport();
    if (!support.isSupported) throw new Error(`MXC sandbox is unavailable: ${support.reason ?? "unsupported platform"}`);
    const roots = new Set<string>();
    const automatic = [process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : undefined, dirname(process.execPath)];
    for (const candidate of [...automatic, ...config.toolRoots]) {
      if (!candidate) continue;
      try { roots.add(await realpath(candidate)); } catch { /* unavailable local tool root */ }
    }
    return new CommandRunner(config, sessions, [...roots]);
  }

  securityStatus(): object {
    const support = getPlatformSupport();
    const warnings = support.isolationWarnings ?? [];
    const systemDrivePrepRequired = warnings.some((warning) => warning.includes("prepare-system-drive") || warning.includes("system-drive root"));
    const nullDevicePrepRequired = warnings.some((warning) => warning.includes("prepare-null-device") || warning.includes("\\Device\\Null"));
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
      configuredToolRoots: this.toolRoots.length,
    };
  }
  async #resolveExecutable(session: Session, command: string): Promise<string> {
    if (!command || command.includes("\0")) throw new Error("command is required");
    if (command.includes("/") || command.includes("\\")) {
      const local = await resolveExisting(session.root, command);
      await access(local, constants.F_OK);
      return local;
    }

    for (const root of this.toolRoots) {
      for (const extension of WINDOWS_EXTENSIONS) {
        const candidate = resolve(root, command + extension);
        try {
          await access(candidate, constants.F_OK);
          const target = await realpath(candidate);
          const rootPrefix = root.endsWith("\\") ? root.toLowerCase() : `${root.toLowerCase()}\\`;
          if (target.toLowerCase() === root.toLowerCase() || target.toLowerCase().startsWith(rootPrefix)) return target;
        } catch { /* keep searching configured roots */ }
      }
    }
    throw new Error(`executable is outside configured tool roots or missing: ${command}`);
  }

  async exec(sessionId: string, argv: string[], cwd = ".", timeoutMs?: number): Promise<ExecResult> {
    if (argv.length === 0) throw new Error("argv must contain an executable");
    const releaseActivity = this.sessions.acquireActivity(sessionId, "workspace.exec");
    let child: ChildProcess | undefined;
    try {
      if (this.#running.has(sessionId)) throw new Error("session already has a running command");
      const session = this.sessions.get(sessionId);
      const workingDirectory = await resolveExisting(session.root, cwd);
      const executable = await this.#resolveExecutable(session, argv[0] ?? "");
      const requestedTimeout = timeoutMs ?? this.config.defaultTimeoutMs;
      if (!Number.isFinite(requestedTimeout) || requestedTimeout < 1_000) {
        throw new Error("timeoutMs must be a finite value of at least 1000ms");
      }
      const timeout = Math.min(Math.trunc(requestedTimeout), 3_600_000);
      const extension = extname(executable).toLowerCase();
      let commandLine: string;
      if (extension === ".cmd" || extension === ".bat") {
        const cmd = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
        const inner = [executable, ...argv.slice(1)].map(quoteWindowsArg).join(" ");
        commandLine = `${quoteWindowsArg(cmd)} /d /s /c "${inner}"`;
      } else {
        commandLine = [executable, ...argv.slice(1)].map(quoteWindowsArg).join(" ");
      }
      const policy = {
        version: "0.7.0-alpha",
        filesystem: { readwritePaths: [session.root], readonlyPaths: [...this.toolRoots, ...session.readonlyRoots] },
        network: { allowOutbound: false, allowLocalNetwork: false },
        ui: { allowWindows: false, clipboard: "none" as const, allowInputInjection: false },
        timeoutMs: timeout,
      };
      const sandbox = createConfigFromPolicy(policy, "process", `pet-dispatcher-${session.id}`);
      if (!sandbox.process) throw new Error("MXC did not create a process configuration");
      sandbox.process.commandLine = commandLine;
      sandbox.process.cwd = workingDirectory;
      const started = Date.now();
      child = spawnSandboxFromConfig(sandbox, { usePty: false }, workingDirectory);
      this.#running.set(sessionId, child);
      const runningChild = child;
      return await new Promise<ExecResult>((resolveResult, reject) => {
        let stdout = "";
        let stderr = "";
        let truncated = false;
        const append = (current: string, chunk: Buffer | string): string => {
          const next = current + chunk.toString();
          if (Buffer.byteLength(next) <= this.config.maxOutputBytes) return next;
          truncated = true;
          return Buffer.from(next).subarray(0, this.config.maxOutputBytes).toString("utf8");
        };
        runningChild.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
        runningChild.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
        runningChild.once("error", (error) => {
          if (this.#running.get(sessionId) === runningChild) this.#running.delete(sessionId);
          releaseActivity();
          reject(error);
        });
        runningChild.once("close", (exitCode) => {
          if (this.#running.get(sessionId) === runningChild) this.#running.delete(sessionId);
          releaseActivity();
          resolveResult({ exitCode, stdout, stderr, truncated, durationMs: Date.now() - started });
        });
      });
    } catch (error) {
      if (!child) releaseActivity();
      throw error;
    }
  }

  cancel(sessionId: string): boolean {
    const child = this.#running.get(sessionId);
    if (!child) return false;
    return child.kill();
  }
}
