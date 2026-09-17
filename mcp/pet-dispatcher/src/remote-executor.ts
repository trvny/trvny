import { freemem, hostname, totalmem, uptime } from "node:os";
import type { DispatcherConfig } from "./config.js";
import { AgentTools } from "./agent-tools.js";
import { HostGit } from "./host-git.js";
import { NetworkBroker } from "./network.js";
import { runRoutedOpenAI, type ManagedFreeRouter } from "./providers.js";
import type { CommandRunner, ExecResult } from "./sandbox.js";
import type { Session, SessionManager } from "./sessions.js";
import {
  deleteWorkspace, listWorkspace, mkdirWorkspace, moveWorkspace, patchWorkspace,
  readManyWorkspace, readWorkspace, searchWorkspace, statWorkspace, treeWorkspace, writeWorkspace,
} from "./workspace-fs.js";
import { isRemoteDirectExecTool, isRemoteDirectWriteTool, type RemoteResult, type RemoteTask } from "./remote-protocol.js";
import type { RemoteTaskExecutor } from "./remote-transport.js";

const MAX_SUMMARY_CHARS = 20_000;
const MAX_DIRECT_RESULT_BYTES = 96 * 1_024;
const MAX_DIRECT_EXEC_STREAM_BYTES = 24 * 1_024;
const AUTO_SESSION_TTL_MINUTES = 30;
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;

const PROFILE_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  inspect: ["workspace.read", "git.read", "network.fetch"],
  code: ["workspace.read", "workspace.write", "process.exec", "git.read", "git.commit", "tests.run", "network.fetch"],
};

function resolveCapabilities(task: RemoteTask): ReadonlySet<string> {
  const profile = PROFILE_CAPABILITIES[task.profile];
  if (!profile) throw new Error(`remote capability profile is not implemented yet: ${task.profile}`);
  const allowed = new Set(profile);
  const requested = task.capabilities.length ? task.capabilities : profile;
  for (const capability of requested) {
    if (!allowed.has(capability)) throw new Error(`capability is not permitted by remote profile ${task.profile}: ${capability}`);
  }
  const selected = new Set(requested);
  if (selected.has("workspace.write") && !selected.has("git.commit")) throw new Error("workspace.write requires git.commit for durable remote changes");
  if (selected.has("process.exec") && !selected.has("workspace.write")) throw new Error("process.exec requires workspace.write in the current MXC profile");
  if (selected.has("git.commit") && !selected.has("workspace.write")) throw new Error("git.commit requires workspace.write");
  if (selected.has("tests.run") && !selected.has("process.exec")) throw new Error("tests.run requires process.exec");
  return selected;
}

function boundedSummary(value: string, fallback: string): string { return (value || fallback).slice(0, MAX_SUMMARY_CHARS); }
function taskRepo(task: RemoteTask): string {
  if (!task.repo) throw new Error("workspace-scoped remote task requires a repository");
  return task.repo;
}
function trimDiff(value: string): string | undefined {
  const trimmed = value.trim(); return trimmed ? trimmed.slice(0, 65_536) : undefined;
}
function stripAnsi(value: string): string { return value.replace(ANSI_ESCAPE, ""); }
function utf8Head(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { text: value, truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maxBytes; end >= Math.max(0, maxBytes - 4); end -= 1) {
    try { return { text: decoder.decode(bytes.subarray(0, end)), truncated: true }; } catch { /* trim incomplete code point */ }
  }
  return { text: bytes.subarray(0, maxBytes).toString("utf8"), truncated: true };
}
function utf8Tail(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { text: value, truncated: false };
  let start = Math.max(0, bytes.length - maxBytes);
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return { text: bytes.subarray(start).toString("utf8"), truncated: true };
}
function boundUtf8(value: string, maxBytes: number, mode: "head" | "tail") {
  return mode === "head" ? utf8Head(value, maxBytes) : utf8Tail(value, maxBytes);
}
function publicDirectSession(session: Session) {
  return {
    id: session.id, repo: session.repo, alias: session.repo, targetKind: session.targetKind ?? "repository", writable: session.writable ?? true,
    initialCommit: session.targetKind !== "workspace" ? session.initialCommit : undefined,
    network: session.network, exportedCommit: session.exportedCommit, exportedRef: session.exportedRef,
    createdAt: session.createdAt, expiresAt: session.expiresAt,
  };
}
function boundedExecResult(
  value: ExecResult,
  maxOutputBytes = MAX_DIRECT_EXEC_STREAM_BYTES,
  mode: "head" | "tail" = "tail",
  shouldStripAnsi = true,
): ExecResult {
  const limit = Math.min(MAX_DIRECT_EXEC_STREAM_BYTES, Math.max(256, maxOutputBytes));
  const stdoutValue = shouldStripAnsi ? stripAnsi(value.stdout) : value.stdout;
  const stderrValue = shouldStripAnsi ? stripAnsi(value.stderr) : value.stderr;
  const stderrFirst = (value.exitCode ?? 0) !== 0 && stderrValue.length > 0;
  const primaryValue = stderrFirst ? stderrValue : stdoutValue;
  const secondaryValue = stderrFirst ? stdoutValue : stderrValue;
  const primary = boundUtf8(primaryValue, limit, mode);
  const remaining = Math.max(0, limit - Buffer.byteLength(primary.text, "utf8"));
  const secondary = boundUtf8(secondaryValue, remaining, mode);
  return {
    ...value,
    stdout: stderrFirst ? secondary.text : primary.text,
    stderr: stderrFirst ? primary.text : secondary.text,
    truncated: value.truncated || primary.truncated || secondary.truncated,
  };
}

export class ConfinedRemoteExecutor implements RemoteTaskExecutor {
  constructor(
    readonly config: DispatcherConfig, readonly sessions: SessionManager, readonly runner: CommandRunner,
    readonly managedFreeRouter?: ManagedFreeRouter,
  ) {}
  readonly #directSessions = new Map<string, { repo: string; expiresAt: number; timer: NodeJS.Timeout }>();

  #directSession(id: string, repo: string) {
    const lease = this.#directSessions.get(id);
    if (!lease) throw new Error(`unknown remote direct session: ${id}`);
    if (lease.repo !== repo) throw new Error("remote direct session target mismatch");
    if (Date.now() > lease.expiresAt) {
      this.#expireDirectSession(id);
      throw new Error("remote direct session expired");
    }
    const session = this.sessions.get(id);
    if (session.repo !== repo) throw new Error("remote direct session target mismatch");
    return session;
  }

  #expireDirectSession(id: string): void {
    const lease = this.#directSessions.get(id);
    if (!lease) return;
    this.sessions.close(id, true).then(() => {
      if (this.#directSessions.get(id) === lease) this.#directSessions.delete(id);
    }).catch(() => {
      if (this.#directSessions.get(id) !== lease) return;
      const retry = setTimeout(() => this.#expireDirectSession(id), 1_000);
      retry.unref(); lease.timer = retry;
    });
  }

  #scheduleDirectSession(id: string, repo: string, ttlMinutes: number): number {
    const expiresAt = Date.now() + ttlMinutes * 60_000;
    const timer = setTimeout(() => this.#expireDirectSession(id), ttlMinutes * 60_000);
    timer.unref(); this.#directSessions.set(id, { repo, expiresAt, timer });
    return expiresAt;
  }

  #clearDirectSession(id: string): void {
    const lease = this.#directSessions.get(id);
    if (lease) clearTimeout(lease.timer);
    this.#directSessions.delete(id);
  }

  async #executeDirect(task: RemoteTask, signal?: AbortSignal): Promise<RemoteResult> {
    const call = task.direct;
    if (!call) throw new Error("direct executor requires a direct tool call");
    if (call.tool === "system.status") {
      return {
        status: "completed", summary: "Legion host status.",
        data: {
          hostname: hostname(), uptimeSeconds: Math.round(uptime()),
          freeMemBytes: freemem(), totalMemBytes: totalmem(),
          activeSessions: this.sessions.activeCount(), activeProcesses: this.runner.activeProcessCount(),
        },
      };
    }
    const capabilities = resolveCapabilities(task);
    const repo = taskRepo(task);
    if (signal?.aborted) {
      const message = signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "remote task aborted");
      return { status: "cancelled", summary: `Direct remote tool ${call.tool} was cancelled.`, error: message.slice(0, 4_096) };
    }
    const execTool = isRemoteDirectExecTool(call.tool);
    const writeTool = isRemoteDirectWriteTool(call.tool);
    const networkProfile = call.tool === "workspace.exec" ? call.networkProfile : undefined;
    const networkMode = networkProfile ? task.network.mode : "none";
    if (execTool && !capabilities.has("process.exec")) throw new Error("direct exec tools require process.exec");
    if (writeTool && (!capabilities.has("workspace.write") || !capabilities.has("git.commit"))) throw new Error("direct write tools require workspace.write and git.commit");
    if (call.tool.startsWith("fs.") && !capabilities.has("workspace.read")) throw new Error("direct filesystem tools require workspace.read");
    if (call.tool.startsWith("git.") && !capabilities.has("git.read")) throw new Error("direct Git tools require git.read");

    if (call.tool === "session.open") {
      try {
        const session = await this.sessions.open(repo, task.baseRef, "none", undefined, false, call.ttlMinutes);
        const expiresAt = this.#scheduleDirectSession(session.id, repo, call.ttlMinutes);
        return { status: "completed", summary: "Direct remote write session opened.", data: { sessionId: session.id, repo: session.repo, alias: session.repo, targetKind: session.targetKind ?? "repository", expiresAt: new Date(expiresAt).toISOString() } };
      } catch (error) {
        return { status: "failed", summary: "Direct remote write session failed to open.", error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
      }
    }
    if (call.tool === "session.list") {
      const value = this.sessions.list().map(publicDirectSession);
      return { status: "completed", summary: "Active Pet Dispatcher sessions listed.", data: { sessions: value } };
    }
    if (call.tool === "session.reclaim") {
      try {
        const session = this.sessions.get(call.sessionId);
        if (session.repo !== repo) throw new Error("remote direct session target mismatch");
        const reclaimed = await this.sessions.reclaim(call.sessionId);
        if (reclaimed) this.#clearDirectSession(call.sessionId);
        return { status: "completed", summary: reclaimed ? "Expired session reclaimed." : "Session was already absent.", data: { reclaimed, sessionId: call.sessionId } };
      } catch (error) {
        return { status: "failed", summary: "Session reclaim refused.", error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
      }
    }
    if (call.tool === "session.close") {
      try {
        const directSession = this.#directSession(call.sessionId, repo);
        let exported: { commit: string; ref: string } | undefined;
        if (!call.discard && directSession.targetKind !== "workspace") {
          const state = await this.sessions.status(call.sessionId);
          if (!state.dirty && state.changedHead && state.session.exportedCommit !== state.head) exported = await new HostGit(this.sessions, this.config).exportCommit(call.sessionId);
        }
        await this.sessions.close(call.sessionId, call.discard);
        this.#clearDirectSession(call.sessionId);
        return {
          status: "completed", summary: "Direct remote write session closed.",
          data: { ok: true, discarded: call.discard, commit: exported?.commit, ref: exported?.ref },
          commit: exported?.commit, exportedRef: exported?.ref,
        };
      } catch (error) {
        return { status: "failed", summary: "Direct remote write session failed to close.", error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
      }
    }
    if (call.tool === "session.finish") {
      try {
        const directSession = this.#directSession(call.sessionId, repo);
        if (directSession.targetKind === "workspace") {
          await this.sessions.close(call.sessionId, false);
          this.#clearDirectSession(call.sessionId);
          return { status: "completed", summary: "Direct workspace session finished.", data: { ok: true, targetKind: "workspace", committed: false } };
        }
        const git = new HostGit(this.sessions, this.config);
        let state = await this.sessions.status(call.sessionId);
        let committed = false;
        if (state.dirty) {
          if (!call.message) throw new Error("session.finish requires a commit message when the repository has uncommitted changes");
          const staged = await git.stageAll(call.sessionId);
          if (staged.exitCode !== 0) throw new Error(`git add -A failed: ${staged.stderr || staged.stdout}`);
          const commitResult = await git.commit(call.sessionId, call.message);
          if (commitResult.exitCode !== 0) throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
          committed = true;
          state = await this.sessions.status(call.sessionId);
        }
        let exported: { commit: string; ref: string } | undefined;
        if (state.changedHead && state.session.exportedCommit !== state.head) exported = await git.exportCommit(call.sessionId);
        const commit = exported?.commit ?? (state.changedHead ? state.head : state.session.exportedCommit ?? undefined);
        const ref = exported?.ref ?? state.session.exportedRef ?? undefined;
        await this.sessions.close(call.sessionId, false);
        this.#clearDirectSession(call.sessionId);
        return {
          status: "completed", summary: "Direct remote session finished.",
          data: { ok: true, targetKind: "repository", committed, commit, ref },
          commit, exportedRef: ref,
        };
      } catch (error) {
        return { status: "failed", summary: "Direct remote session failed to finish.", error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
      }
    }

    const sessionId = "sessionId" in call ? call.sessionId : undefined;
    const autoSession = "autoSession" in call && call.autoSession === true;
    let temporary = false;
    let autoOpened = false;
    let session: Session | undefined;
    try {
      if (sessionId) session = this.#directSession(sessionId, repo);
      else if (writeTool || execTool) {
        if (!autoSession) throw new Error("direct state-changing tools require a remote session or autoSession=true");
        session = await this.sessions.open(repo, task.baseRef, networkMode, networkProfile, false, AUTO_SESSION_TTL_MINUTES);
        this.#scheduleDirectSession(session.id, repo, AUTO_SESSION_TTL_MINUTES);
        autoOpened = true;
      } else {
        session = await this.sessions.openRead(repo, task.baseRef, "none", undefined, 5);
        temporary = true;
      }
      const activeSession = session;
      if (call.tool === "workspace.exec") {
        if (activeSession.network.mode !== networkMode || activeSession.network.profile !== (networkProfile ?? null)) {
          throw new Error("workspace.exec network profile does not match the active session");
        }
      }
      const git = new HostGit(this.sessions, this.config);
      let exported: { commit: string; ref: string } | undefined;
      const value = call.tool === "workspace.exec"
        ? boundedExecResult(
            await this.runner.exec(activeSession.id, call.argv, call.cwd, call.timeoutMs, signal, { memoryMiB: call.memoryMiB, processLimit: call.processLimit }),
            call.maxOutputBytes, call.outputMode, call.stripAnsi,
          )
        : await this.sessions.runActivity(activeSession.id, "remote-direct", async () => {
          switch (call.tool) {
            case "session.status": {
              if (activeSession.targetKind === "workspace") return { session: publicDirectSession(activeSession), dirty: null, changedHead: null };
              const state = await this.sessions.status(activeSession.id);
              return { ...state, session: publicDirectSession(state.session) };
            }
            case "fs.list": return listWorkspace(activeSession, call.path);
            case "fs.stat": return statWorkspace(activeSession, call.path);
            case "fs.read": return { content: await readWorkspace(activeSession, call.path, 60_000) };
            case "fs.readMany": return readManyWorkspace(activeSession, call.paths, { maxBytesPerFile: call.maxBytesPerFile, maxTotalBytes: call.maxTotalBytes });
            case "fs.tree": return treeWorkspace(activeSession, call.path, { depth: call.depth, maxEntries: call.maxEntries });
            case "fs.search": return searchWorkspace(activeSession, {
              query: call.query, path: call.path, maxMatches: call.maxMatches, maxFiles: call.maxFiles,
              maxFileBytes: call.maxFileBytes, maxDepth: call.maxDepth,
            });
            case "workspace.inspect": {
              const includeTree = call.include.includes("tree");
              const includeGit = call.include.includes("git");
              const [treeResult, searchResult, gitResult] = await Promise.allSettled([
                includeTree ? treeWorkspace(activeSession, call.path, { depth: call.depth, maxEntries: call.maxEntries, maxBytes: call.maxTreeBytes }) : undefined,
                call.query ? searchWorkspace(activeSession, {
                  query: call.query, path: call.path, maxMatches: call.maxMatches, maxFiles: call.maxFiles,
                  maxFileBytes: call.maxFileBytes, maxDepth: call.maxDepth, maxBytes: call.maxSearchBytes,
                }) : undefined,
                includeGit && activeSession.targetKind !== "workspace" ? git.summary(activeSession.id, call.maxCommits) : undefined,
              ]);
              for (const result of [treeResult, searchResult, gitResult]) {
                if (result.status === "rejected") throw result.reason;
              }
              const tree = treeResult.status === "fulfilled" ? treeResult.value : undefined;
              const search = searchResult.status === "fulfilled" ? searchResult.value : undefined;
              const gitSummary = gitResult.status === "fulfilled" ? gitResult.value : undefined;
              const compactGit = gitSummary ? {
                ...gitSummary,
                staged: { ...gitSummary.staged, paths: gitSummary.staged.paths.slice(0, call.maxGitPaths) },
                unstaged: { ...gitSummary.unstaged, paths: gitSummary.unstaged.paths.slice(0, call.maxGitPaths) },
              } : includeGit ? null : undefined;
              const data = { targetKind: activeSession.targetKind ?? "repository", path: call.path, tree, search, git: compactGit };
              if (compactGit) {
                const resultBytes = () => Buffer.byteLength(JSON.stringify({
                  status: "completed", summary: `Direct remote tool ${call.tool} completed.`, data,
                }), "utf8");
                while (resultBytes() > MAX_DIRECT_RESULT_BYTES && (compactGit.staged.paths.length || compactGit.unstaged.paths.length)) {
                  const paths = compactGit.staged.paths.length >= compactGit.unstaged.paths.length
                    ? compactGit.staged.paths : compactGit.unstaged.paths;
                  paths.pop();
                }
              }
              return data;
            }
            case "fs.write": {
              if (Buffer.byteLength(call.content, "utf8") > 65_536) throw new Error("direct fs.write content exceeds 64 KiB");
              await writeWorkspace(activeSession, call.path, call.content); return { ok: true };
            }
            case "fs.patch": await patchWorkspace(activeSession, call.path, call.oldText, call.newText); return { ok: true };
            case "fs.mkdir": await mkdirWorkspace(activeSession, call.path); return { ok: true };
            case "fs.move": await moveWorkspace(activeSession, call.from, call.to); return { ok: true };
            case "fs.delete": await deleteWorkspace(activeSession, call.path); return { ok: true };
            case "git.status": return git.status(activeSession.id);
            case "git.diff": return git.diff(activeSession.id, call.staged, call.paths);
            case "git.summary": return git.summary(activeSession.id, call.maxCommits);
            case "git.add": {
              const result = await git.add(activeSession.id, call.paths);
              if (result.exitCode !== 0) throw new Error(`git add failed: ${result.stderr || result.stdout}`);
              return result;
            }
            case "git.commit": {
              const result = await git.commit(activeSession.id, call.message);
              if (result.exitCode !== 0) throw new Error(`git commit failed: ${result.stderr || result.stdout}`);
              exported = await git.exportCommit(activeSession.id);
              return { ...result, commit: exported.commit, ref: exported.ref };
            }
            default: throw new Error("unsupported direct remote tool");
          }
        });
      if (signal?.aborted) throw signal.reason ?? new Error("remote direct call aborted");
      if (temporary) {
        if (session.targetKind !== "workspace") {
          const state = await this.sessions.status(session.id);
          if (state.dirty || state.changedHead) throw new Error("read-only direct call unexpectedly changed the session");
        }
        await this.sessions.close(session.id, false);
      }
      const data = autoOpened && value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>), sessionId: activeSession.id }
        : value;
      const result: RemoteResult = { status: "completed", summary: `Direct remote tool ${call.tool} completed.`, data, commit: exported?.commit, exportedRef: exported?.ref };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_DIRECT_RESULT_BYTES) throw new Error("direct tool result exceeds remote callback limit");
      return result;
    } catch (error) {
      if ((temporary || autoOpened) && session) {
        await this.sessions.close(session.id, true).catch(() => undefined);
        if (autoOpened) this.#clearDirectSession(session.id);
      }
      const abortReason = signal?.aborted ? signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "remote task aborted") : undefined;
      const message = abortReason ?? (error instanceof Error ? error.message : String(error));
      const cancelled = abortReason === "remote task cancellation requested";
      return { status: cancelled ? "cancelled" : "failed", summary: cancelled ? `Direct remote tool ${call.tool} was cancelled.` : `Direct remote tool ${call.tool} failed.`, error: message.slice(0, 4_096) };
    }
  }

  async execute(task: RemoteTask, taskId: string, signal?: AbortSignal): Promise<RemoteResult> {
    if (task.executor === "direct") return this.#executeDirect(task, signal);
    if (task.executor === "gemini") {
      return {
        status: "failed",
        summary: "Legacy remote Gemini task was not executed.",
        error: "remote Gemini executor is retired; resubmit through the managed free-router",
      };
    }
    const repo = taskRepo(task);
    const capabilities = resolveCapabilities(task);
    let session: Session | undefined;
    let git: HostGit | undefined;
    try {
      session = await this.sessions.open(repo, task.baseRef, task.network.mode, task.network.profile, false, Math.min(60, task.timeoutMinutes + 5));
      if (session.targetKind === "workspace") throw new Error("delegated agents are disabled for non-Git workspaces; use confined direct tools");
      git = new HostGit(this.sessions, this.config);
      const tools = new AgentTools(this.sessions, this.runner, new NetworkBroker(this.config), git, capabilities, signal);
      const commitInstruction = capabilities.has("git.commit")
        ? "\n\nWhen the task changes files, validate them and commit the finished work with git_commit before returning."
        : "\n\nThis task is read-only. Do not attempt writes, execution, staging or commits.";
      if (!task.goal) throw new Error("agent executor requires a goal");
      const goal = `[remote task ${taskId}] ${task.goal}${commitInstruction}`;
      const agent = await this.sessions.runActivity(session.id, "remote-agent", async () => {
        return runRoutedOpenAI(this.config, tools, session!.id, goal, 16, signal, this.managedFreeRouter);
      });
      const state = await this.sessions.status(session.id);
      const [unstaged, staged] = state.dirty ? [await git.diff(session.id), await git.diff(session.id, true)] : [{ stdout: "" }, { stdout: "" }];
      const diff = trimDiff(`${unstaged.stdout}\n${staged.stdout}`);
      if (state.dirty) {
        return { status: "failed", summary: boundedSummary(agent.text, "Agent returned with uncommitted workspace changes."), diff, error: "remote agent left uncommitted changes; workspace was discarded" };
      }
      let exported: { commit: string; ref: string } | undefined;
      if (state.changedHead) exported = await git.exportCommit(session.id);
      await this.sessions.close(session.id, false);
      session = undefined;
      return { status: "completed", summary: boundedSummary(agent.text, `Remote ${agent.provider} task completed.`), diff, commit: exported?.commit, exportedRef: exported?.ref };
    } catch (error) {
      const abortReason = signal?.aborted ? signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "remote task aborted") : undefined;
      const message = abortReason ?? (error instanceof Error ? error.message : String(error));
      let diff: string | undefined;
      if (session && git && session.targetKind !== "workspace") {
        try {
          const unstaged = await git.diff(session.id); const staged = await git.diff(session.id, true);
          diff = trimDiff(`${unstaged.stdout}\n${staged.stdout}`);
        } catch { /* diagnostics only */ }
      }
      const cancelled = abortReason === "remote task cancellation requested";
      return { status: cancelled ? "cancelled" : "failed", summary: cancelled ? "Remote task was cancelled." : "Remote confined agent task failed.", diff, error: message.slice(0, 4_096) };
    } finally {
      if (session) await this.sessions.close(session.id, true).catch(() => undefined);
    }
  }
}
