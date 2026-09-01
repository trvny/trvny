import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DispatcherConfig } from "./config.js";
import { gitSafetyArgs, isolatedGitEnvironment, resolveTrustedGitExecutable } from "./git-runtime.js";
import { resolveExisting, resolveForCreate, validateRelativePath } from "./path-guard.js";
import type { Session, SessionManager } from "./sessions.js";

const execFileAsync = promisify(execFile);


async function cleanPaths(session: Session, paths: string[]): Promise<string[]> {
  if (paths.length === 0) throw new Error("at least one path is required");
  const clean: string[] = [];
  for (const path of paths) {
    const value = validateRelativePath(path);
    if (value === ".") throw new Error("git adapter requires explicit paths, not '.'");
    if (value.split(/[\\/]/u).includes("..")) throw new Error("git path may not contain '..' segments");
    if (value.startsWith("-")) throw new Error("git paths may not begin with '-'");
    try {
      await resolveExisting(session.root, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await resolveForCreate(session.root, value);
    }
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
    this.#gitExecutable ??= resolveTrustedGitExecutable(this.config);
    return this.#gitExecutable;
  }

  async probe(): Promise<{ available: boolean; mode: string; error?: string }> {
    try {
      await this.#gitPath();
      return { available: true, mode: "structured-session-host-adapter" };
    } catch (error) {
      return {
        available: false,
        mode: "structured-session-host-adapter",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }


  async #runUnlocked(session: Session, args: string[]): Promise<GitResult> {
    const gitExecutable = await this.#gitPath();
    const home = join(session.gitDir, "pet-dispatcher-home");
    await mkdir(home, { recursive: true });
    try {
      const { stdout, stderr } = await execFileAsync(
        gitExecutable,
        ["--git-dir", session.gitDir, "--work-tree", session.root, ...gitSafetyArgs, ...args],
        {
          cwd: session.root,
          env: isolatedGitEnvironment(gitExecutable, join(session.gitDir, "pet-dispatcher-home")),
          maxBuffer: this.config.maxOutputBytes,
          windowsHide: true,
        },
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
    return this.sessions.runHostOperation(sessionId, (session) =>
      this.#runUnlocked(session, ["status", "--short", "--branch"]));
  }

  async diff(sessionId: string, staged = false, paths: string[] = []): Promise<GitResult> {
    return this.sessions.runHostOperation(sessionId, async (session) => {
      const args = ["diff", "--no-ext-diff", "--no-textconv"];
      if (staged) args.push("--cached");
      if (paths.length) args.push("--", ...await cleanPaths(session, paths));
      return this.#runUnlocked(session, args);
    });
  }

  async add(sessionId: string, paths: string[]): Promise<GitResult> {
    return this.sessions.runHostOperation(sessionId, async (session) =>
      this.#runUnlocked(session, ["add", "--", ...await cleanPaths(session, paths)]));
  }

  async commit(sessionId: string, message: string): Promise<GitResult> {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) throw new Error("commit message must be 1-500 characters");
    if (trimmed.includes("\0")) throw new Error("invalid commit message");
    return this.sessions.runHostOperation(sessionId, (session) => this.#runUnlocked(session, [
      "-c", "user.name=GPTomek",
      "-c", "user.email=314538226+gptomek[bot]@users.noreply.github.com",
      "commit", "--no-verify", "-m", trimmed,
    ]));
  }

  async exportCommit(sessionId: string): Promise<{ commit: string; ref: string }> {
    return this.sessions.runHostOperation(sessionId, async (session) => {
      const headResult = await this.#runUnlocked(session, ["rev-parse", "--verify", "HEAD"]);
      if (headResult.exitCode !== 0) throw new Error(`cannot resolve session HEAD: ${headResult.stderr}`);
      const commit = headResult.stdout.trim();
      const ref = `refs/pet-dispatcher/${session.id}`;
      const gitExecutable = await this.#gitPath();
      const args = [
        "-C", session.sourceRoot,
        ...gitSafetyArgs,
        "fetch", "--no-tags", session.gitDir, `HEAD:${ref}`,
      ];
      try {
        await execFileAsync(gitExecutable, args, {
          cwd: session.sourceRoot,
          env: isolatedGitEnvironment(gitExecutable, join(session.gitDir, "pet-dispatcher-home")),
          maxBuffer: this.config.maxOutputBytes,
          windowsHide: true,
        });
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { stderr?: string };
        throw new Error(`failed to export session commit: ${failure.stderr ?? failure.message}`);
      }
      const { stdout } = await execFileAsync(
        gitExecutable,
        ["-C", session.sourceRoot, "rev-parse", "--verify", `${ref}^{commit}`],
        {
          cwd: session.sourceRoot,
          env: isolatedGitEnvironment(gitExecutable, join(session.gitDir, "pet-dispatcher-home")),
          maxBuffer: this.config.maxOutputBytes,
          windowsHide: true,
        },
      );
      if (stdout.trim() !== commit) throw new Error("exported ref does not match the session HEAD");
      this.sessions.markExported(sessionId, commit, ref);
      return { commit, ref };
    });
  }
}
