import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

export interface JobGuardLimits { memoryMiB: number; processLimit: number }
export interface JobGuardStats { peakMemoryBytes: number; activeProcesses: number; killReason: string | null }
interface GuardResponse { id?: string; ok?: boolean; error?: string; result?: { peakMemoryBytes?: number; activeProcesses?: number; killReason?: string | null } | null; ready?: boolean }

function boundedInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  const integer = Math.trunc(value);
  if (integer < min || integer > max) throw new Error(`${name} must be ${min}-${max}`);
  return integer;
}

async function helperPath(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../scripts/windows-job-guard.ps1"),
    resolve(here, "../../scripts/windows-job-guard.ps1"),
    resolve(process.cwd(), "scripts/windows-job-guard.ps1"),
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* next */ }
  }
  throw new Error("Windows Job Object guardian script is missing");
}

function normalizeStats(value: GuardResponse["result"]): JobGuardStats {
  return {
    peakMemoryBytes: Math.max(0, Number(value?.peakMemoryBytes ?? 0)),
    activeProcesses: Math.max(0, Number(value?.activeProcesses ?? 0)),
    killReason: typeof value?.killReason === "string" && value.killReason ? value.killReason : null,
  };
}

export class WindowsJobGuard {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<string, { resolve(value: GuardResponse): void; reject(error: Error): void }>();
  #closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) { this.#child = child; }

  static async create(watchdogIntervalMs: number): Promise<WindowsJobGuard | undefined> {
    if (process.platform !== "win32") return undefined;
    const script = await helperPath();
    const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-WatchdogIntervalMs", String(watchdogIntervalMs)], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const guard = new WindowsJobGuard(child);
    await guard.#initialize();
    return guard;
  }

  async #initialize(): Promise<void> {
    const reader = createInterface({ input: this.#child.stdout });
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
    let stderr = "";
    this.#child.stderr.on("data", (chunk: Buffer | string) => { stderr = `${stderr}${String(chunk)}`.slice(-8_192); });
    reader.on("line", (line) => {
      let message: GuardResponse;
      try { message = JSON.parse(line) as GuardResponse; }
      catch { return; }
      if (message.ready) { readyResolve(); return; }
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(message.error ?? "Windows Job Object guardian request failed"));
    });
    this.#child.once("error", (error) => readyReject(error));
    this.#child.once("exit", (code) => {
      this.#closed = true;
      const error = new Error(`Windows Job Object guardian exited (${code ?? "signal"})${stderr ? `: ${stderr}` : ""}`);
      readyReject(error);
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
    const timer = setTimeout(() => readyReject(new Error(`Windows Job Object guardian did not become ready${stderr ? `: ${stderr}` : ""}`)), 20_000);
    timer.unref();
    try { await ready; } catch (error) { this.#child.kill(); throw error; }
    finally { clearTimeout(timer); }
  }

  async #request(op: string, payload: Record<string, unknown>): Promise<GuardResponse> {
    if (this.#closed || !this.#child.stdin.writable) throw new Error("Windows Job Object guardian is unavailable");
    const id = randomUUID();
    const response = new Promise<GuardResponse>((resolveResponse, rejectResponse) => this.#pending.set(id, { resolve: resolveResponse, reject: rejectResponse }));
    this.#child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`, (error) => {
      if (!error) return;
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      pending.reject(error);
    });
    return response;
  }

  async attach(jobId: string, pid: number, limits: JobGuardLimits): Promise<JobGuardStats> {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("cannot guard a process without a valid pid");
    const memoryMiB = boundedInteger(limits.memoryMiB, "memoryMiB", 256, 6_144);
    const processLimit = boundedInteger(limits.processLimit, "processLimit", 1, 64);
    const response = await this.#request("attach", { jobId, pid, memoryBytes: memoryMiB * 1_048_576, processLimit });
    return normalizeStats(response.result);
  }

  async kill(jobId: string, reason: string): Promise<JobGuardStats | undefined> {
    const response = await this.#request("kill", { jobId, reason });
    return response.result ? normalizeStats(response.result) : undefined;
  }

  async stats(jobId: string): Promise<JobGuardStats | undefined> {
    const response = await this.#request("stats", { jobId });
    return response.result ? normalizeStats(response.result) : undefined;
  }

  async release(jobId: string): Promise<JobGuardStats | undefined> {
    const response = await this.#request("release", { jobId });
    return response.result ? normalizeStats(response.result) : undefined;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.stdin.end();
    await new Promise<void>((resolveClose) => {
      if (this.#child.exitCode !== null) { resolveClose(); return; }
      const timer = setTimeout(() => { this.#child.kill(); resolveClose(); }, 2_000);
      timer.unref();
      this.#child.once("exit", () => { clearTimeout(timer); resolveClose(); });
    });
  }
}
