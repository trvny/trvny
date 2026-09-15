import { execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DispatcherConfig } from "./config.js";
import { gitSafetyArgs, isolatedGitEnvironment, resolveTrustedGitExecutable } from "./git-runtime.js";
import type { NetworkAccess, NetworkMode } from "./network.js";
import { assertInside } from "./path-guard.js";

const execFileAsync = promisify(execFile);
const LEGACY_SESSION_GRACE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MINUTES = 30;

export type SessionTargetKind = "repository" | "workspace";

export interface Session {
  id: string;
  repo: string;
  targetKind: SessionTargetKind;
  writable: boolean;
  sessionDir: string;
  root: string;
  gitDir: string;
  sourceRoot: string;
  initialCommit: string;
  readonlyRoots: string[];
  network: NetworkAccess;
  exportedCommit: string | null;
  exportedRef: string | null;
  createdAt: string;
  expiresAt: string;
}

interface Activity { kind: string; token: symbol }

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH" && code !== "EINVAL";
  }
}

export class SessionManager {
  readonly #sessions = new Map<string, Session>();
  readonly #writers = new Map<string, string>();
  readonly #activity = new Map<string, Activity>();
  readonly #activityContext = new AsyncLocalStorage<{ id: string; token: symbol }>();
  readonly #initialization: Promise<void>;
  readonly #reaper: NodeJS.Timeout;
  #initializationError?: Error;
  #gitExecutable?: Promise<string>;
  #terminateProcesses?: (sessionId: string) => Promise<boolean | void>;

  constructor(readonly config: DispatcherConfig) {
    this.#initialization = this.#cleanupOrphanedSessions().catch((error: unknown) => {
      this.#initializationError = error instanceof Error ? error : new Error(String(error));
    });
    this.#reaper = setInterval(() => {
      this.reap().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[pet-dispatcher] session reaper warning: ${message}\n`);
      });
    }, config.sessionReaperIntervalMs ?? 15_000);
    this.#reaper.unref();
  }

  setProcessTerminator(terminate: (sessionId: string) => Promise<boolean | void>): void {
    this.#terminateProcesses = terminate;
  }

  dispose(): void { clearInterval(this.#reaper); }

  async #ready(): Promise<void> {
    await this.#initialization;
    if (this.#initializationError) throw this.#initializationError;
  }

  async #cleanupOrphanedSessions(): Promise<void> {
    const sessionsRoot = resolve(this.config.workspaceRoot, "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || this.#sessions.has(entry.name)) continue;
      const candidate = resolve(sessionsRoot, entry.name);
      assertInside(sessionsRoot, candidate);
      let ownerPid: number | undefined;
      try {
        const owner = JSON.parse(await readFile(join(candidate, "owner.json"), "utf8")) as { pid?: unknown };
        if (typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0) ownerPid = owner.pid;
      } catch { /* legacy or partially-created session */ }
      if (ownerPid !== undefined) {
        if (processIsAlive(ownerPid)) continue;
      } else {
        const info = await stat(candidate);
        if (Date.now() - info.mtimeMs < LEGACY_SESSION_GRACE_MS) continue;
      }
      await rm(candidate, { recursive: true, force: true });
    }
  }

  get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new Error(`unknown session: ${id}`);
    return session;
  }

  list(): Session[] { return [...this.#sessions.values()]; }
  activeCount(): number { return this.#sessions.size; }
  activeOperationCount(): number { return this.#activity.size; }

  #gitPath(): Promise<string> {
    this.#gitExecutable ??= resolveTrustedGitExecutable(this.config);
    return this.#gitExecutable;
  }

  #gitOptions(gitExecutable: string, home: string) {
    return { env: isolatedGitEnvironment(gitExecutable, home), maxBuffer: this.config.maxOutputBytes, windowsHide: true };
  }

  acquireActivity(id: string, kind: string): () => void {
    this.get(id);
    const current = this.#activity.get(id);
    const inherited = this.#activityContext.getStore();
    if (current && inherited?.id === id && inherited.token === current.token) return () => undefined;
    if (current) throw new Error(`session already has an active ${current.kind} operation`);
    const token = Symbol(kind);
    this.#activity.set(id, { kind, token });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.#activity.get(id)?.token === token) this.#activity.delete(id);
    };
  }

  async runActivity<T>(id: string, kind: string, operation: () => Promise<T>): Promise<T> {
    const release = this.acquireActivity(id, kind);
    const activity = this.#activity.get(id);
    if (!activity) { release(); throw new Error("failed to reserve session activity"); }
    try { return await this.#activityContext.run({ id, token: activity.token }, operation); }
    finally { release(); }
  }

  async runHostOperation<T>(id: string, operation: (session: Session) => Promise<T>): Promise<T> {
    const release = this.acquireActivity(id, "host");
    try { return await operation(this.get(id)); }
    finally { release(); }
  }

  #network(mode: NetworkMode, profile?: string): NetworkAccess {
    if (mode === "none") {
      if (profile) throw new Error("network profile is not valid when network mode is none");
      return { mode, profile: null };
    }
    if (!profile) throw new Error(`${mode} network mode requires a configured profile`);
    if (!this.config.networkProfiles[profile]) throw new Error(`unknown network profile: ${profile}`);
    if (mode === "restricted") throw new Error("restricted direct egress is not available yet on this host; use brokered mode");
    return { mode, profile };
  }

  async open(repo: string, ref = "HEAD", networkMode: NetworkMode = "none", networkProfile?: string, sync = false, ttlMinutes = DEFAULT_SESSION_TTL_MINUTES): Promise<Session> {
    return this.#open(repo, ref, networkMode, networkProfile, sync, ttlMinutes, true);
  }

  async openRead(repo: string, ref = "HEAD", networkMode: NetworkMode = "none", networkProfile?: string, ttlMinutes = 5): Promise<Session> {
    return this.#open(repo, ref, networkMode, networkProfile, false, ttlMinutes, false);
  }

  async #open(repo: string, ref: string, networkMode: NetworkMode, networkProfile: string | undefined, sync: boolean, ttlMinutes: number, writable: boolean): Promise<Session> {
    await this.#ready();
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 60) throw new Error("session TTL must be 1-60 minutes");
    const repoRoot = this.config.repositories[repo];
    const workspaceRoot = this.config.workspaces?.[repo];
    const targetKind: SessionTargetKind = repoRoot ? "repository" : workspaceRoot ? "workspace" : (() => { throw new Error(`target is not configured: ${repo}`); })();
    const configuredRoot = repoRoot ?? workspaceRoot;
    if (!configuredRoot) throw new Error(`target is not configured: ${repo}`);
    if (sync) throw new Error("session sync requires restricted host egress and is unavailable in Phase 1");
    if (writable && this.#writers.has(repo)) throw new Error(`target already has a writer session: ${repo}`);
    if (targetKind === "repository" && !/^(?!-)[A-Za-z0-9._/@+:-]+$/.test(ref)) throw new Error("invalid git ref");
    const network = this.#network(networkMode, networkProfile);
    const id = randomUUID();
    if (writable) this.#writers.set(repo, id);
    let sessionDir: string | undefined;
    try {
      const sourceRoot = await realpath(configuredRoot);
      const sessionsRoot = resolve(this.config.workspaceRoot, "sessions");
      await mkdir(sessionsRoot, { recursive: true });
      sessionDir = resolve(sessionsRoot, id);
      assertInside(sessionsRoot, sessionDir);
      await mkdir(sessionDir, { recursive: true });
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
      await writeFile(join(sessionDir, "owner.json"), JSON.stringify({ pid: process.pid, createdAt, expiresAt, alias: repo, targetKind }), "utf8");

      let root = sourceRoot;
      let gitDir = "";
      let initialCommit = "";
      if (targetKind === "repository") {
        const gitExecutable = await this.#gitPath();
        root = resolve(sessionDir, "worktree");
        gitDir = resolve(sessionDir, "git");
        const hostHome = resolve(sessionDir, "host-home");
        await mkdir(hostHome, { recursive: true });
        const gitOptions = this.#gitOptions(gitExecutable, hostHome);
        const { stdout } = await execFileAsync(gitExecutable, [...gitSafetyArgs, "-C", sourceRoot, "rev-parse", "--verify", `${ref}^{commit}`], gitOptions);
        initialCommit = stdout.trim();
        await execFileAsync(gitExecutable, [...gitSafetyArgs, "clone", "--no-local", "--no-checkout", "--separate-git-dir", gitDir, sourceRoot, root], gitOptions);
        await execFileAsync(gitExecutable, [...gitSafetyArgs, "--git-dir", gitDir, "--work-tree", root, "checkout", "--detach", initialCommit], gitOptions);
        await rm(join(root, ".git"), { force: true });
        root = await realpath(root);
        gitDir = await realpath(gitDir);
      }
      const session: Session = {
        id, repo, targetKind, writable, sessionDir: await realpath(sessionDir), root,
        gitDir, sourceRoot, initialCommit, readonlyRoots: [], network,
        exportedCommit: null, exportedRef: null, createdAt, expiresAt,
      };
      this.#sessions.set(id, session);
      return session;
    } catch (error) {
      if (sessionDir) await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      if (writable && this.#writers.get(repo) === id) this.#writers.delete(repo);
      throw error;
    }
  }

  #assertGitSession(session: Session): void {
    if (session.targetKind !== "repository") throw new Error("workspace session is not a Git target");
  }

  async #statusUnlocked(session: Session): Promise<{ session: Session; head: string; dirty: boolean; changedHead: boolean }> {
    this.#assertGitSession(session);
    const gitExecutable = await this.#gitPath();
    const home = join(session.gitDir, "pet-dispatcher-home");
    await mkdir(home, { recursive: true });
    const prefix = [...gitSafetyArgs, "--git-dir", session.gitDir, "--work-tree", session.root];
    const options = { ...this.#gitOptions(gitExecutable, home), cwd: session.root };
    const [{ stdout: headOut }, { stdout: statusOut }] = await Promise.all([
      execFileAsync(gitExecutable, [...prefix, "rev-parse", "HEAD"], options),
      execFileAsync(gitExecutable, [...prefix, "status", "--porcelain"], options),
    ]);
    const head = headOut.trim();
    return { session, head, dirty: statusOut.trim().length > 0, changedHead: head !== session.initialCommit };
  }

  status(id: string): Promise<{ session: Session; head: string; dirty: boolean; changedHead: boolean }> {
    return this.runHostOperation(id, (session) => this.#statusUnlocked(session));
  }

  markExported(id: string, commit: string, ref: string): void {
    const session = this.get(id);
    this.#assertGitSession(session);
    session.exportedCommit = commit;
    session.exportedRef = ref;
  }

  async close(id: string, discard = false): Promise<void> {
    const existing = this.get(id);
    if (this.#terminateProcesses) await this.#terminateProcesses(id).catch(() => undefined);
    const release = this.acquireActivity(id, "close");
    let cleanupError: unknown;
    try {
      const session = this.get(id);
      if (!discard && session.targetKind === "repository") {
        const state = await this.#statusUnlocked(session);
        const headIsExported = session.exportedCommit === state.head;
        if (state.dirty || (state.changedHead && !headIsExported)) {
          throw new Error("session has unexported changes; export the current commit or close with discard=true");
        }
      }
      const sessionsRoot = await realpath(resolve(this.config.workspaceRoot, "sessions"));
      assertInside(sessionsRoot, session.sessionDir);
      await rm(session.sessionDir, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error;
    } finally {
      this.#sessions.delete(id);
      this.#activity.delete(id);
      if (existing.writable && this.#writers.get(existing.repo) === id) this.#writers.delete(existing.repo);
      release();
    }
    if (cleanupError) throw cleanupError;
  }

  async reclaim(id: string, now = Date.now()): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > now) throw new Error("session is not expired and cannot be reclaimed");
    await this.close(id, true).catch(() => undefined);
    return !this.#sessions.has(id);
  }

  async reap(now = Date.now()): Promise<number> {
    await this.#ready();
    let reclaimed = 0;
    for (const session of [...this.#sessions.values()]) {
      const expiresAt = Date.parse(session.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now && await this.reclaim(session.id, now)) reclaimed += 1;
    }
    await this.#cleanupOrphanedSessions();
    return reclaimed;
  }
}
