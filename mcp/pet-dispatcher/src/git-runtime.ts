import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DispatcherConfig } from "./config.js";

export const gitSafetyArgs = [
  "-c", "core.hooksPath=NUL",
  "-c", "core.fsmonitor=false",
  "-c", "credential.helper=",
  "-c", "commit.gpgSign=false",
  "-c", "tag.gpgSign=false",
] as const;

export function isolatedGitEnvironment(gitExecutable: string, home: string): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATH: dirname(gitExecutable),
    PATHEXT: process.env.PATHEXT,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: resolve(home, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
}

export async function resolveTrustedGitExecutable(config: DispatcherConfig): Promise<string> {
  const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
  for (const configuredRoot of config.toolRoots) {
    let root: string;
    try { root = await realpath(configuredRoot); }
    catch { continue; }
    for (const name of names) {
      const candidate = resolve(root, name);
      try {
        await access(candidate, constants.F_OK);
        const target = await realpath(candidate);
        const rel = target.slice(root.length);
        const separated = rel === "" || rel.startsWith("\\") || rel.startsWith("/");
        if (target.toLowerCase().startsWith(root.toLowerCase()) && separated) return target;
      } catch { /* try the next configured tool root */ }
    }
  }
  throw new Error("trusted Git executable was not found in configured toolRoots");
}
