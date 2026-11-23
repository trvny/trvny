import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** AppContainer profile name MXC creates for a session's sandboxed commands. */
export function containerNameForSession(sessionId: string): string {
  return `pet-dispatcher-${sessionId}`;
}

export type ProfileRunner = (powershell: string, args: string[]) => Promise<unknown>;

async function scriptPath(): Promise<string | undefined> {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, "../scripts/delete-appcontainer-profile.ps1"),
    resolve(here, "../../scripts/delete-appcontainer-profile.ps1"),
    resolve(process.cwd(), "scripts/delete-appcontainer-profile.ps1"),
  ]) {
    try { await access(candidate); return candidate; } catch { /* next */ }
  }
  return undefined;
}

/**
 * Delete the AppContainer profile of a closed session. Without this every session leaves a
 * profile behind (registry Storage/Mappings entries + a folder under %LOCALAPPDATA%\Packages).
 * Best effort: returns false instead of throwing, session close must not fail on cleanup.
 */
export async function deleteSessionContainerProfile(
  sessionId: string,
  run: ProfileRunner = (powershell, args) => execFileAsync(powershell, args, { windowsHide: true, timeout: 15_000 }),
): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const script = await scriptPath();
  if (!script) return false;
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Name", containerNameForSession(sessionId)]);
    return true;
  } catch {
    return false;
  }
}
