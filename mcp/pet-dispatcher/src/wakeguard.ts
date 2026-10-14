import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WakeguardAction = "on" | "off" | "status";
export interface WakeguardState {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  until: string | null;
  heartbeatAgeSeconds: number | null;
  guards: number;
}
export type WakeguardControl = (action: WakeguardAction, minutes?: number) => Promise<WakeguardState>;

/** Default length for `on` without minutes. The schema caps remote requests at 720. */
export const WAKEGUARD_DEFAULT_MINUTES = 120;

/** Drives bin\pet-dispatcher-wakeguard.ps1 (Windows PowerShell 5.1) under the install root. The helper prints one
 *  JSON object on stdout and keeps the actual guard as its own detached process, so a worker restart does not drop it. */
export function createWakeguardControl(installRoot: string): WakeguardControl {
  const script = join(installRoot, "bin", "pet-dispatcher-wakeguard.ps1");
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return async (action, minutes) => {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", action, "-Root", installRoot];
    if (action === "on") args.push("-Minutes", String(minutes ?? WAKEGUARD_DEFAULT_MINUTES));
    const { stdout } = await execFileAsync(powershell, args, { windowsHide: true, timeout: 45_000, maxBuffer: 64 * 1024 });
    return parseWakeguardState(stdout);
  };
}

export function parseWakeguardState(stdout: string): WakeguardState {
  const line = stdout.trim().split(/\r?\n/u).at(-1) ?? "";
  const value = JSON.parse(line) as Record<string, unknown>;
  if (typeof value.error === "string") throw new Error(`wakeguard: ${value.error}`);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    running: value.running === true, pid: num(value.pid), startedAt: str(value.startedAt), until: str(value.until),
    heartbeatAgeSeconds: num(value.heartbeatAgeSeconds), guards: num(value.guards) ?? 0,
  };
}
