import type { DispatcherConfig } from "./config.js";
import { AgentTools } from "./agent-tools.js";
import { HostGit } from "./host-git.js";
import { NetworkBroker } from "./network.js";
import { runGemini, runOpenRouter } from "./providers.js";
import type { CommandRunner, ExecResult } from "./sandbox.js";
import type { Session, SessionManager } from "./sessions.js";
import { listWorkspace, readWorkspace, statWorkspace, writeWorkspace } from "./workspace-fs.js";
import { isRemoteDirectExecTool, isRemoteDirectWriteTool, type RemoteResult, type RemoteTask } from "./remote-protocol.js";
import type { RemoteTaskExecutor } from "./remote-transport.js";

const MAX_SUMMARY_CHARS = 20_000;
const MAX_DIRECT_OUTPUT_CHARS = 65_536;
const MAX_DIRECT_RESULT_BYTES = 96 * 1_024;
const MAX_DIRECT_EXEC_STREAM_BYTES = 24 * 1_024;

const PROFILE_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  inspect: ["workspace.read", "git.read", "network.fetch"],
  code: [
    "workspace.read", "workspace.write", "process.exec", "git.read",
    "git.commit", "tests.run", "network.fetch",
  ],
};

function resolveCapabilities(task: RemoteTask): ReadonlySet<string> {
  const profile = PROFILE_CAPABILITIES[task.profile];
  if (!profile) throw new Error(`remote capability profile is not implemented yet: ${task.profile}`);
  const allowed = new Set(profile);
  const requested = task.capabilities.length ? task.capabilities : profile;
  for (const capability of requested) {
    if (!allowed.has(capability)) {
      throw new Error(`capability is not permitted by remote profile ${task.profile}: ${capability}`);
    }
  }
  const selected = new Set(requested);
  if (selected.has("workspace.write") && !selected.has("git.commit")) {
    throw new Error("workspace.write requires git.commit for durable remote changes");
  }
  if (selected.has("process.exec") && !selected.has("workspace.write")) {
    throw new Error("process.exec requires workspace.write in the current MXC profile");
  }
  if (selected.has("git.commit") && !selected.has("workspace.write")) {
    throw new Error("git.commit requires workspace.write");
  }
  if (selected.has("tests.run") && !selected.has("process.exec")) {
    throw new Error("tests.run requires process.exec");
  }
  return selected;
}

function boundedSummary(value: string, fallback: string): string {
  return (value || fallback).slice(0, MAX_SUMMARY_CHARS);
}

function trimDiff(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 65_536);
}

function boundUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { text: value, truncated: false };
  let end = maxBytes;
  while (end > 0 && (((bytes[end] ?? 0) & 0xc0) === 0x80)) end -= 1;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

function boundedExecResult(value: ExecResult): ExecResult {
  const stdout = boundUtf8(value.stdout, MAX_DIRECT_EXEC_STREAM_BYTES);
  const stderr = boundUtf8(value.stderr, MAX_DIRECT_EXEC_STREAM_BYTES);
  return {
    ...value,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: value.truncated || stdout.truncated || stderr.truncated,
  };
}

export class ConfinedRemoteExecutor implements RemoteTaskExecutor {
  constructor(
    readonly config: DispatcherConfig,
    readonly sessions: SessionManager,
    readonly runner: CommandRunner,
  ) {}

  readonly #directSessions = new Map<string, { repo: string; expiresAt: number; timer: NodeJS.Timeout }>();

  #directSession(id: string, repo: string) {
    const lease = this.#directSessions.get(id);
    if (!lease) throw new Error(`unknown remote direct session: ${id}`);
    if (lease.repo !== repo) throw new Error("remote direct session repository mismatch");
    if (Date.now() > lease.expiresAt) {
      this.#expireDirectSession(id);
      throw new Error("remote direct session expired");
    }
    const session = this.sessions.get(id);
    if (session.repo !== repo) throw new Error("remote direct session repository mismatch");
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
      retry.unref();
      lease.timer = retry;
    });
  }

  #scheduleDirectSession(id: string, repo: string, ttlMinutes: number): number {
    const expiresAt = Date.now() + ttlMinutes * 60_000;
    const timer = setTimeout(() => this.#expireDirectSession(id), ttlMinutes * 60_000);
    timer.unref();
    this.#directSessions.set(id, { repo, expiresAt, timer });
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
    const capabilities = resolveCapabilities(task);
    if (signal?.aborted) {
      const message = signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "remote task aborted");
      return { status: "cancelled", summary: `Direct remote tool ${call.tool} was cancelled.`, error: message.slice(0, 4_096) };
    }
    const execTool = isRemoteDirectExecTool(call.tool);
    const writeTool = isRemoteDirectWriteTool(call.tool);
    if (execTool && !capabilities.has("process.exec")) throw new Error("direct exec tools require process.exec");
    if (writeTool && (!capabilities.has("workspace.write") || !capabilities.has("git.commit"))) throw new Error("direct write tools require workspace.write and git.commit");
    if (call.tool.startsWith("fs.") && !capabilities.has("workspace.read")) throw new Error("direct filesystem tools require workspace.read");
    if (call.tool.startsWith("git.") && !capabilities.has("git.read")) throw new Error("direct Git tools require git.read");

    if (call.tool === "session.open") {
      try {
        const session = await this.sessions.open(task.repo, task.baseRef, "none", undefined, false);
        const expiresAt = this.#scheduleDirectSession(session.id, task.repo, call.ttlMinutes);
        return { status: "completed", summary: "Direct remote write session opened.", output: JSON.stringify({ sessionId: session.id, repo: session.repo, expiresAt: new Date(expiresAt).toISOString() }) };
      } catch (error) {
        return { status: "failed", summary: "Direct remote write session failed to open.", error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
      }
    }
    if (call.tool === "session.close") {
      try {
        this.#directSession(call.sessionId, task.repo);
        let exported: { commit: string; ref: string } | undefined;
        if (!call.discard) {
          const state = await this.sessions.status(call.sessionId);
          if (!state.dirty && state.changedHead && state.session.exportedCommit !== state.head) {
            exported = await new HostGit(this.sessions, this.config).exportCommit(call.sessionId);
          }
        }
        await this.sessions.close(call.sessionId, call.discard);
        this.#clearDirectSession(call.sessionId);
        return {
          status: "completed",
          summary: "Direct remote write session closed.",
          output: JSON.stringify({ ok: true, discarded: call.discard, commit: exported?.commit, ref: exported?.ref }),
          commit: exported?.commit,
          exportedRef: exported?.ref,
        };
      } catch (error) {
        return { status: "failed", summary: "Direct remote write session failed to close.", error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
      }
    }

    const sessionId = "sessionId" in call ? call.sessionId : undefined;
    let temporary = false;
    let session: Session | undefined;
    try {
      if (sessionId) {
        session = this.#directSession(sessionId, task.repo);
      } else {
        if (writeTool || execTool) throw new Error("direct state-changing tools require a remote session");
        session = await this.sessions.open(task.repo, task.baseRef, "none", undefined, false);
        temporary = true;
      }
      const activeSession = session;
      if (!activeSession) throw new Error("failed to resolve direct session");
      const git = new HostGit(this.sessions, this.config);
      let exported: { commit: string; ref: string } | undefined;
      const value = call.tool === "workspace.exec"
        ? boundedExecResult(await this.runner.exec(activeSession.id, call.argv, call.cwd, call.timeoutMs, signal))
        : await this.sessions.runActivity(activeSession.id, "remote-direct", async () => {
        switch (call.tool) {
          case "fs.list": return listWorkspace(activeSession, call.path);
          case "fs.stat": return statWorkspace(activeSession, call.path);
          case "fs.read": return { content: await readWorkspace(activeSession, call.path, 60_000) };
          case "fs.write": {
            if (Buffer.byteLength(call.content, "utf8") > 65_536) throw new Error("direct fs.write content exceeds 64 KiB");
            await writeWorkspace(activeSession, call.path, call.content);
            return { ok: true };
          }
          case "git.status": return git.status(activeSession.id);
          case "git.diff": return git.diff(activeSession.id, call.staged, call.paths);
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
        const state = await this.sessions.status(session.id);
        if (state.dirty || state.changedHead) throw new Error("read-only direct call unexpectedly changed the session");
        await this.sessions.close(session.id, false);
      }
      const output = JSON.stringify(value);
      if (output.length > MAX_DIRECT_OUTPUT_CHARS) throw new Error("direct tool output exceeds remote result limit");
      const result: RemoteResult = {
        status: "completed",
        summary: `Direct remote tool ${call.tool} completed.`,
        output,
        commit: exported?.commit,
        exportedRef: exported?.ref,
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_DIRECT_RESULT_BYTES) throw new Error("direct tool result exceeds remote callback limit");
      return result;
    } catch (error) {
      if (temporary && session) await this.sessions.close(session.id, true).catch(() => undefined);
      const abortReason = signal?.aborted
        ? signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "remote task aborted")
        : undefined;
      const message = abortReason ?? (error instanceof Error ? error.message : String(error));
      const cancelled = abortReason === "remote task cancellation requested";
      return {
        status: cancelled ? "cancelled" : "failed",
        summary: cancelled ? `Direct remote tool ${call.tool} was cancelled.` : `Direct remote tool ${call.tool} failed.`,
        error: message.slice(0, 4_096),
      };
    }
  }

  async execute(task: RemoteTask, taskId: string, signal?: AbortSignal): Promise<RemoteResult> {
    if (task.executor === "direct") return this.#executeDirect(task, signal);
    const capabilities = resolveCapabilities(task);
    const session = await this.sessions.open(
      task.repo,
      task.baseRef,
      task.network.mode,
      task.network.profile,
      false,
    );
    const git = new HostGit(this.sessions, this.config);
    const tools = new AgentTools(
      this.sessions,
      this.runner,
      new NetworkBroker(this.config),
      git,
      capabilities,
      signal,
    );
    const commitInstruction = capabilities.has("git.commit")
      ? "\n\nWhen the task changes files, validate them and commit the finished work with git_commit before returning."
      : "\n\nThis task is read-only. Do not attempt writes, execution, staging or commits.";
    if (!task.goal) throw new Error("agent executor requires a goal");
    const goal = `[remote task ${taskId}] ${task.goal}${commitInstruction}`;

    try {
      const agent = await this.sessions.runActivity(session.id, "remote-agent", async () => {
        if (task.executor === "gemini") {
          return runGemini(this.config, tools, session.id, goal, undefined, 16, signal);
        }
        return runOpenRouter(this.config, tools, session.id, goal, undefined, 16, signal);
      });
      const state = await this.sessions.status(session.id);
      const [unstaged, staged] = state.dirty
        ? await Promise.all([git.diff(session.id), git.diff(session.id, true)])
        : [{ stdout: "" }, { stdout: "" }];
      const diff = trimDiff(`${unstaged.stdout}\n${staged.stdout}`);

      if (state.dirty) {
        await this.sessions.close(session.id, true);
        return {
          status: "failed",
          summary: boundedSummary(agent.text, "Agent returned with uncommitted workspace changes."),
          diff,
          error: "remote agent left uncommitted changes; workspace was discarded",
        };
      }

      let exported: { commit: string; ref: string } | undefined;
      if (state.changedHead) exported = await git.exportCommit(session.id);
      await this.sessions.close(session.id, false);
      return {
        status: "completed",
        summary: boundedSummary(agent.text, `Remote ${agent.provider} task completed.`),
        diff,
        commit: exported?.commit,
        exportedRef: exported?.ref,
      };
    } catch (error) {
      const abortReason = signal?.aborted
        ? signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "remote task aborted")
        : undefined;
      const message = abortReason ?? (error instanceof Error ? error.message : String(error));
      let diff: string | undefined;
      try {
        const [unstaged, staged] = await Promise.all([git.diff(session.id), git.diff(session.id, true)]);
        diff = trimDiff(`${unstaged.stdout}\n${staged.stdout}`);
      } catch { /* best-effort diagnostics only */ }
      await this.sessions.close(session.id, true).catch(() => undefined);
      const cancelled = abortReason === "remote task cancellation requested";
      return {
        status: cancelled ? "cancelled" : "failed",
        summary: cancelled ? "Remote task was cancelled." : "Remote confined agent task failed.",
        diff,
        error: message.slice(0, 4_096),
      };
    }
  }
}
