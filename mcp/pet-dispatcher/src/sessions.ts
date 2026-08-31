import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DispatcherConfig } from "./config.js";
import type { NetworkAccess, NetworkMode } from "./network.js";
import { gitSafetyArgs, isolatedGitEnvironment, resolveTrustedGitExecutable } from "./git-runtime.js";
import { assertInside } from "./path-guard.js";

const execFileAsync = promisify(execFile);

export interface Session {
  id: string;
  repo: string;
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
}

interface Activity {
  kind: string;
  token: symbol;
}

export class SessionManager {
  readonly #sessions = new Map<string, Session>();
  readonly #writers = new Map<string, string>();
  readonly #activity = new Map<string, Activity>();
  #gitExecutable?: Promise<string>;

  constructor(readonly config: DispatcherConfig) {}

  get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new Error(`unknown session: ${id}`);
    return session;
  }

  list(): Session[] { return [...this.#sessions.values()]; }

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
    if (mode === "restricted") {
      throw new Error("restricted direct egress is not available yet on this host; use brokered mode");
    }
    return { mode, profile };
  }

  async open(
    repo: string,
    ref = "HEAD",
    networkMode: NetworkMode = "none",
    networkProfile?: string,
    sync = false,
  ): Promise<Session> {
    const sourceConfigured = this.config.repositories[repo];
    if (!sourceConfigured) throw new Error(`repository is not configured: ${repo}`);
    if (sync) throw new Error("session sync requires restricted host egress and is unavailable in Phase 1");
    if (this.#writers.has(repo)) throw new Error(`repository already has a writer session: ${repo}`);
    if (!/^(?!-)[A-Za-z0-9._/@+:-]+$/.test(ref)) throw new Error("invalid git ref");
    const network = this.#network(networkMode, networkProfile);
    const id = randomUUID();
    this.#writers.set(repo, id);
    let sessionDir: string | undefined;
    try {
      const sourceRoot = await realpath(sourceConfigured);
      const gitExecutable = await this.#gitPath();
      const sessionsRoot = resolve(this.config.workspaceRoot, "sessions");
      await mkdir(sessionsRoot, { recursive: true });
      sessionDir = resolve(sessionsRoot, id);
      assertInside(sessionsRoot, sessionDir);
      const root = resolve(sessionDir, "worktree");
      const gitDir = resolve(sessionDir, "git");
      const hostHome = resolve(sessionDir, "host-home");
      await mkdir(hostHome, { recursive: true });
      const gitOptions = this.#gitOptions(gitExecutable, hostHome);
      const { stdout } = await execFileAsync(gitExecutable, [...gitSafetyArgs, "-C", sourceRoot, "rev-parse", "--verify", `${ref}^{commit}`], gitOptions);
      const initialCommit = stdout.trim();

      await execFileAsync(gitExecutable, [...gitSafetyArgs, "clone", "--shared", "--no-checkout", "--separate-git-dir", gitDir, sourceRoot, root], gitOptions);
      await execFileAsync(gitExecutable, [...gitSafetyArgs, "--git-dir", gitDir, "--work-tree", root, "checkout", "--detach", initialCommit], gitOptions);
      await rm(join(root, ".git"), { force: true });
      const readonlyRoots: string[] = [];
      const session: Session = {
        id, repo, sessionDir: await realpath(sessionDir), root: await realpath(root), gitDir: await realpath(gitDir),
        sourceRoot, initialCommit, readonlyRoots, network, exportedCommit: null, exportedRef: null,
        createdAt: new Date().toISOString(),
      };
      this.#sessions.set(id, session);
      return session;
    } catch (error) {
      if (sessionDir) await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      if (this.#writers.get(repo) === id) this.#writers.delete(repo);
      throw error;
    }
  }

  async #statusUnlocked(session: Session): Promise<{ session: Session; head: string; dirty: boolean; changedHead: boolean }> {
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

  async status(id: string): Promise<{ session: Session; head: string; dirty: boolean; changedHead: boolean }> {
    return this.runHostOperation(id, (session) => this.#statusUnlocked(session));
  }

  markExported(id: string, commit: string, ref: string): void {
    const session = this.get(id);
    session.exportedCommit = commit;
    session.exportedRef = ref;
  }

  async close(id: string, discard = false): Promise<void> {
    const release = this.acquireActivity(id, "close");
    try {
      const session = this.get(id);
      const state = await this.#statusUnlocked(session);
      const headIsExported = session.exportedCommit === state.head;
      if (!discard && (state.dirty || (state.changedHead && !headIsExported))) {
        throw new Error("session has unexported changes; export the current commit or close with discard=true");
      }
      const sessionsRoot = resolve(this.config.workspaceRoot, "sessions");
      assertInside(sessionsRoot, session.sessionDir);
      await rm(session.sessionDir, { recursive: true, force: true });
      this.#sessions.delete(id);
      if (this.#writers.get(session.repo) === id) this.#writers.delete(session.repo);
    } finally { release(); }
  }

}
