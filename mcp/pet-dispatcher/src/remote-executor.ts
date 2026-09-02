import type { DispatcherConfig } from "./config.js";
import { AgentTools } from "./agent-tools.js";
import { HostGit } from "./host-git.js";
import { NetworkBroker } from "./network.js";
import { runGemini, runOpenRouter } from "./providers.js";
import type { CommandRunner } from "./sandbox.js";
import type { SessionManager } from "./sessions.js";
import { listWorkspace, readWorkspace, statWorkspace } from "./workspace-fs.js";
import type { RemoteResult, RemoteTask } from "./remote-protocol.js";
import type { RemoteTaskExecutor } from "./remote-transport.js";

const MAX_SUMMARY_CHARS = 20_000;
const MAX_DIRECT_OUTPUT_CHARS = 65_536;
const MAX_DIRECT_RESULT_BYTES = 96 * 1_024;

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

export class ConfinedRemoteExecutor implements RemoteTaskExecutor {
  constructor(
    readonly config: DispatcherConfig,
    readonly sessions: SessionManager,
    readonly runner: CommandRunner,
  ) {}

  async #executeDirect(task: RemoteTask, signal?: AbortSignal): Promise<RemoteResult> {
    const call = task.direct;
    if (!call) throw new Error("direct executor requires a direct tool call");
    const capabilities = resolveCapabilities(task);
    if (signal?.aborted) throw signal.reason ?? new Error("remote direct call aborted");
    if (call.tool.startsWith("fs.") && !capabilities.has("workspace.read")) {
      throw new Error("direct filesystem tools require workspace.read");
    }
    if (call.tool.startsWith("git.") && !capabilities.has("git.read")) {
      throw new Error("direct Git tools require git.read");
    }
    const session = await this.sessions.open(task.repo, task.baseRef, "none", undefined, false);
    const git = new HostGit(this.sessions, this.config);
    try {
      const value = await this.sessions.runActivity(session.id, "remote-direct", async () => {
        switch (call.tool) {
          case "fs.list": return listWorkspace(session, call.path);
          case "fs.stat": return statWorkspace(session, call.path);
          case "fs.read": return { content: await readWorkspace(session, call.path, 60_000) };
          case "git.status": return git.status(session.id);
          case "git.diff": return git.diff(session.id, call.staged, call.paths);
        }
      });
      const state = await this.sessions.status(session.id);
      if (state.dirty || state.changedHead) throw new Error("read-only direct call unexpectedly changed the session");
      const output = JSON.stringify(value);
      if (output.length > MAX_DIRECT_OUTPUT_CHARS) throw new Error("direct tool output exceeds remote result limit");
      const result: RemoteResult = { status: "completed", summary: `Direct remote tool ${call.tool} completed.`, output };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_DIRECT_RESULT_BYTES) {
        throw new Error("direct tool result exceeds remote callback limit");
      }
      await this.sessions.close(session.id, false);
      return result;
    } catch (error) {
      await this.sessions.close(session.id, true).catch(() => undefined);
      return { status: "failed", summary: `Direct remote tool ${call.tool} failed.`, error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) };
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
