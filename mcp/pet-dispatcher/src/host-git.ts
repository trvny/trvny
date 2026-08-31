import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DispatcherConfig } from "./config.js";
import { resolveExisting, resolveForCreate, validateRelativePath } from "./path-guard.js";
import type { Session, SessionManager } from "./sessions.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 1_048_576;

function gitEnvironment(session: Session, gitExecutable: string): NodeJS.ProcessEnv {
  const home = join(session.root, ".git", "pet-dispatcher", "git-home");
  return {
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATH: dirname(gitExecutable),
    PATHEXT: process.env.PATHEXT,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}
function baseArgs(session: Session): string[] {
  return [
    "-C", session.root,
    "-c", "core.hooksPath=NUL",
    "-c", "core.fsmonitor=false",
    "-c", "credential.helper=",
    "-c", "commit.gpgSign=false",
    "-c", "tag.gpgSign=false",
  ];
}

async function cleanPaths(session: Session, paths: string[]): Promise<string[]> {
  if (paths.length === 0) throw new Error("at least one path is required");
  const clean: string[] = [];
  for (const path of paths) {
    const value = validateRelativePath(path);
    if (value === ".") throw new Error("git adapter requires explicit paths, not '.'");
    if (value.split(/[\\/]/u).includes("..")) throw new Error("git path may not contain '..' segments");
    if (value.startsWith("-")) throw new Error("git paths may not begin with '-'");
    try { await resolveExisting(session.root, value); }
    catch { await resolveForCreate(session.root, value); }
    clean.push(value);
  }
  return clean;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export class HostGit {
  #gitExecutable?: Promise<string>;

  constructor(readonly sessions: SessionManager, readonly config: DispatcherConfig) {}

  #gitPath(): Promise<string> {
    this.#gitExecutable ??= this.#resolveGitExecutable();
    return this.#gitExecutable;
  }

  async probe(): Promise<{ available: boolean; mode: string; error?: string }> {
    try {
      await this.#gitPath();
      return { available: true, mode: "structured-session-host-adapter" };
    } catch (error) {
      return { available: false, mode: "structured-session-host-adapter", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async #resolveGitExecutable(): Promise<string> {
    const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
    for (const configuredRoot of this.config.toolRoots) {
      let root: string;
      try { root = await realpath(configuredRoot); }
      catch { continue; }
      for (const name of names) {
        const candidate = resolve(root, name);
        try {
          await access(candidate, constants.F_OK);
          const target = await realpath(candidate);
          const prefix = root.endsWith("\\") ? root.toLowerCase() : `${root.toLowerCase()}\\`;
          if (target.toLowerCase() === root.toLowerCase() || target.toLowerCase().startsWith(prefix)) return target;
        } catch { /* try next configured tool root */ }
      }
    }
    throw new Error("trusted Git executable was not found in configured toolRoots");
  }

  async #run(session: Session, args: string[]): Promise<GitResult> {
    const gitExecutable = await this.#gitPath();
    const home = join(session.root, ".git", "pet-dispatcher", "git-home");
    await mkdir(home, { recursive: true });
    try {
      const { stdout, stderr } = await execFileAsync(
        gitExecutable,
        [...baseArgs(session), ...args],
        { cwd: session.root, env: gitEnvironment(session, gitExecutable), maxBuffer: MAX_OUTPUT, windowsHide: true },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
      };
    }
  }

  async status(sessionId: string): Promise<GitResult> {
    return this.#run(this.sessions.get(sessionId), ["status", "--short", "--branch", "--untracked-files=no"]);
  }

  async diff(sessionId: string, staged = false, paths: string[] = []): Promise<GitResult> {
    const session = this.sessions.get(sessionId);
    const args = ["diff", "--no-ext-diff", "--no-textconv"];
    if (staged) args.push("--cached");
    if (paths.length) args.push("--", ...await cleanPaths(session, paths));
    return this.#run(session, args);
  }
  async add(sessionId: string, paths: string[]): Promise<GitResult> {
    const session = this.sessions.get(sessionId);
    return this.#run(session, ["add", "--", ...await cleanPaths(session, paths)]);
  }

  async exportCommit(sessionId: string): Promise<{ commit: string; ref: string }> {
    const session = this.sessions.get(sessionId);
    const headResult = await this.#run(session, ["rev-parse", "--verify", "HEAD"]);
    if (headResult.exitCode !== 0) throw new Error(`cannot resolve session HEAD: ${headResult.stderr}`);
    const commit = headResult.stdout.trim();
    const ref = `refs/pet-dispatcher/${session.id}`;
    const gitExecutable = await this.#gitPath();
    const args = [
      "-C", session.sourceRoot,
      "-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "-c", "credential.helper=",
      "fetch", "--no-tags", session.root, `HEAD:${ref}`,
    ];
    try {
      await execFileAsync(gitExecutable, args, {
        cwd: session.sourceRoot,
        env: gitEnvironment(session, gitExecutable),
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
      });
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string };
      throw new Error(`failed to export session commit: ${failure.stderr ?? failure.message}`);
    }
    const { stdout } = await execFileAsync(gitExecutable, ["-C", session.sourceRoot, "rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: session.sourceRoot, env: gitEnvironment(session, gitExecutable), maxBuffer: MAX_OUTPUT, windowsHide: true,
    });
    if (stdout.trim() !== commit) throw new Error("exported ref does not match the session HEAD");
    this.sessions.markExported(sessionId, commit, ref);
    return { commit, ref };
  }

  async commit(sessionId: string, message: string): Promise<GitResult> {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) throw new Error("commit message must be 1-500 characters");
    if (trimmed.includes("\0")) throw new Error("invalid commit message");
    return this.#run(this.sessions.get(sessionId), [
      "-c", "user.name=GPTomek",
      "-c", "user.email=314538226+gptomek[bot]@users.noreply.github.com",
      "commit", "--no-verify", "-m", trimmed,
    ]);
  }
}
