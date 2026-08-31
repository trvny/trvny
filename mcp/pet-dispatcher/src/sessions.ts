import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DispatcherConfig } from "./config.js";
import type { NetworkAccess, NetworkMode } from "./network.js";
import { assertInside } from "./path-guard.js";

const execFileAsync = promisify(execFile);

export interface Session {
  id: string;
  repo: string;
  root: string;
  sourceRoot: string;
  initialCommit: string;
  readonlyRoots: string[];
  network: NetworkAccess;
  exportedCommit: string | null;
  exportedRef: string | null;
  createdAt: string;
}

export class SessionManager {
  readonly #sessions = new Map<string, Session>();
  readonly #writers = new Map<string, string>();

  constructor(readonly config: DispatcherConfig) {}

  get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new Error(`unknown session: ${id}`);
    return session;
  }

  list(): Session[] { return [...this.#sessions.values()]; }
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
    if (this.#writers.has(repo)) throw new Error(`repository already has a writer session: ${repo}`);
    if (!/^(?!-)[A-Za-z0-9._/@+:-]+$/.test(ref)) throw new Error("invalid git ref");
    const network = this.#network(networkMode, networkProfile);
    const id = randomUUID();
    this.#writers.set(repo, id);
    let root: string | undefined;
    try {
      const sourceRoot = await realpath(sourceConfigured);
      if (sync) await execFileAsync("git", ["-C", sourceRoot, "fetch", "--prune", "origin"]);
      const { stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "--verify", `${ref}^{commit}`]);
      const initialCommit = stdout.trim();
      const sessionsRoot = resolve(this.config.workspaceRoot, "sessions");
      await mkdir(sessionsRoot, { recursive: true });
      root = resolve(sessionsRoot, id);
      assertInside(sessionsRoot, root);
      await execFileAsync("git", ["clone", "--shared", "--no-checkout", sourceRoot, root]);
      await execFileAsync("git", ["-C", root, "checkout", "--detach", initialCommit]);
      const readonlyRoots = await this.#sharedObjectRoots(root);
      const session: Session = {
        id, repo, root: await realpath(root), sourceRoot, initialCommit, readonlyRoots, network,
        exportedCommit: null, exportedRef: null, createdAt: new Date().toISOString(),
      };
      this.#sessions.set(id, session);
      return session;
    } catch (error) {
      if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
      if (this.#writers.get(repo) === id) this.#writers.delete(repo);
      throw error;
    }
  }

  async status(id: string): Promise<{ session: Session; head: string; dirty: boolean; changedHead: boolean }> {
    const session = this.get(id);
    const [{ stdout: headOut }, { stdout: statusOut }] = await Promise.all([
      execFileAsync("git", ["-C", session.root, "rev-parse", "HEAD"]),
      execFileAsync("git", ["-C", session.root, "status", "--porcelain"]),
    ]);
    const head = headOut.trim();
    return { session, head, dirty: statusOut.trim().length > 0, changedHead: head !== session.initialCommit };
  }

  markExported(id: string, commit: string, ref: string): void {
    const session = this.get(id);
    session.exportedCommit = commit;
    session.exportedRef = ref;
  }

  async close(id: string, discard = false): Promise<void> {
    const state = await this.status(id);
    const headIsExported = state.session.exportedCommit === state.head;
    if (!discard && (state.dirty || (state.changedHead && !headIsExported))) {
      throw new Error("session has unexported changes; export the current commit or close with discard=true");
    }
    const sessionsRoot = resolve(this.config.workspaceRoot, "sessions");
    assertInside(sessionsRoot, state.session.root);
    await rm(state.session.root, { recursive: true, force: true });
    this.#sessions.delete(id);
    if (this.#writers.get(state.session.repo) === id) this.#writers.delete(state.session.repo);
  }

  async #sharedObjectRoots(root: string): Promise<string[]> {
    try {
      const raw = await readFile(join(root, ".git", "objects", "info", "alternates"), "utf8");
      const roots: string[] = [];
      for (const line of raw.split(/\r?\n/).filter(Boolean)) roots.push(await realpath(line));
      return roots;
    } catch {
      return [];
    }
  }
}
