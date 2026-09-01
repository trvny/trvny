import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DispatcherConfig } from "./config.js";
import { HostGit } from "./host-git.js";
import type { Session, SessionManager } from "./sessions.js";
import type { CommandRunner } from "./sandbox.js";
import { AgentTools } from "./agent-tools.js";
import { NetworkBroker } from "./network.js";
import { runGemini, runOpenRouter } from "./providers.js";
import {
  deleteWorkspace, listWorkspace, mkdirWorkspace, moveWorkspace, patchWorkspace,
  readWorkspace, statWorkspace, writeWorkspace,
} from "./workspace-fs.js";

function response(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function publicSession(session: Session) {
  return {
    id: session.id,
    repo: session.repo,
    initialCommit: session.initialCommit,
    network: session.network,
    exportedCommit: session.exportedCommit,
    exportedRef: session.exportedRef,
    createdAt: session.createdAt,
  };
}

export function createServer(config: DispatcherConfig, sessions: SessionManager, runner: CommandRunner): McpServer {
  const server = new McpServer({
    name: "pet-dispatcher",
    version: "0.1.0",
    description: "Workspace-confined local development tools and agent routing.",
  });
  const broker = new NetworkBroker(config);
  const git = new HostGit(sessions, config);
  const agentTools = new AgentTools(sessions, runner, broker, git);
  const host = <T>(sessionId: string, operation: (session: Session) => Promise<T>) =>
    sessions.runHostOperation(sessionId, operation);
  server.registerTool("security_status", {
    description: "Report the local sandbox backend, configured repositories and provider availability.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => response({
    sandbox: runner.securityStatus(),
    repositories: Object.keys(config.repositories).sort(),
    providers: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
      claude: "planned adapter; not exposed by the Phase 1 worker",
    },
    networkProfiles: broker.profileNames(),
    git: await git.probe(),
  }));

  server.registerTool("open_session", {
    description: "Create one isolated writable checkout for a configured repository. Host paths are never accepted.",
    inputSchema: {
      repo: z.string().min(1),
      ref: z.string().default("HEAD"),
      networkMode: z.enum(["none", "brokered", "restricted"]).default("none"),
      networkProfile: z.string().min(1).optional(),
      sync: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ repo, ref, networkMode, networkProfile, sync }) =>
    response(publicSession(await sessions.open(repo, ref, networkMode, networkProfile, sync))));

  server.registerTool("session_status", {
    description: "Inspect one active session without exposing its host path.",
    inputSchema: { sessionId: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    const state = await sessions.status(sessionId);
    return response({ ...state, session: publicSession(state.session) });
  });
  server.registerTool("close_session", {
    description: "Close and clean a session. Refuses to discard unexported changes unless discard=true.",
    inputSchema: { sessionId: z.string().uuid(), discard: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, discard }) => {
    await sessions.close(sessionId, discard);
    return response({ closed: true, sessionId });
  });

  server.registerTool("fs_list", {
    description: "List a directory relative to the assigned session root.",
    inputSchema: { sessionId: z.string().uuid(), path: z.string().default(".") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => response({ entries: await host(sessionId, (session) => listWorkspace(session, path)) }));

  server.registerTool("fs_stat", {
    description: "Read metadata for a path relative to the assigned session root.",
    inputSchema: { sessionId: z.string().uuid(), path: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => response(await host(sessionId, (session) => statWorkspace(session, path))));

  server.registerTool("fs_read", {
    description: "Read one UTF-8 text file relative to the assigned session root.",
    inputSchema: { sessionId: z.string().uuid(), path: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => response({ content: await host(sessionId, (session) => readWorkspace(session, path)) }));
  server.registerTool("fs_write", {
    description: "Create or replace one UTF-8 file inside the assigned session root.",
    inputSchema: { sessionId: z.string().uuid(), path: z.string().min(1), content: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, path, content }) => {
    await host(sessionId, (session) => writeWorkspace(session, path, content));
    return response({ ok: true });
  });

  server.registerTool("fs_patch", {
    description: "Replace one unique text fragment inside a session file.",
    inputSchema: {
      sessionId: z.string().uuid(), path: z.string().min(1), oldText: z.string().min(1), newText: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, path, oldText, newText }) => {
    await host(sessionId, (session) => patchWorkspace(session, path, oldText, newText));
    return response({ ok: true });
  });

  server.registerTool("fs_mkdir", {
    description: "Create one directory inside the assigned session root.",
    inputSchema: { sessionId: z.string().uuid(), path: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, path }) => {
    await host(sessionId, (session) => mkdirWorkspace(session, path));
    return response({ ok: true });
  });
  server.registerTool("fs_move", {
    description: "Move or rename a path inside the assigned session root.",
    inputSchema: { sessionId: z.string().uuid(), from: z.string().min(1), to: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, from, to }) => {
    await host(sessionId, (session) => moveWorkspace(session, from, to));
    return response({ ok: true });
  });

  server.registerTool("fs_delete", {
    description: "Delete a path inside the assigned session root. The root itself cannot be deleted.",
    inputSchema: { sessionId: z.string().uuid(), path: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, path }) => {
    await host(sessionId, (session) => deleteWorkspace(session, path));
    return response({ ok: true });
  });

  server.registerTool("git_status", {
    description: "Read Git status using the session-bound host adapter.",
    inputSchema: { sessionId: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId }) => response(await git.status(sessionId)));

  server.registerTool("git_diff", {
    description: "Read a Git diff without external diff/textconv helpers.",
    inputSchema: { sessionId: z.string().uuid(), staged: z.boolean().default(false), paths: z.array(z.string()).default([]) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, staged, paths }) => response(await git.diff(sessionId, staged, paths)));

  server.registerTool("git_add", {
    description: "Stage workspace-relative paths using the session-bound host Git adapter.",
    inputSchema: { sessionId: z.string().uuid(), paths: z.array(z.string()).min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, paths }) => response(await git.add(sessionId, paths)));

  server.registerTool("git_commit", {
    description: "Commit staged changes as GPTomek with hooks and signing disabled.",
    inputSchema: { sessionId: z.string().uuid(), message: z.string().min(1).max(500) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, message }) => response(await git.commit(sessionId, message)));

  server.registerTool("git_export", {
    description: "Preserve the current session HEAD under a dispatcher ref in the configured source repository.",
    inputSchema: { sessionId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId }) => response(await git.exportCommit(sessionId)));

  server.registerTool("workspace_exec", {
    description: "Execute an argv-style developer command inside the session's MXC sandbox.",
    inputSchema: {
      sessionId: z.string().uuid(),
      argv: z.array(z.string()).min(1),
      cwd: z.string().default("."),
      timeoutMs: z.number().int().min(1000).max(3600000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ sessionId, argv, cwd, timeoutMs }) => response(await runner.exec(sessionId, argv, cwd, timeoutMs)));
  server.registerTool("http_fetch", {
    description: "Fetch an allowlisted HTTPS URL through the dispatcher broker. Direct sandbox sockets remain blocked.",
    inputSchema: {
      sessionId: z.string().uuid(),
      url: z.string().url(),
      method: z.enum(["GET", "HEAD"]).default("GET"),
      accept: z.string().max(256).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ sessionId, url, method, accept }) =>
    response(await broker.request(sessions.get(sessionId), { url, method, accept })));

  server.registerTool("workspace_cancel", {
    description: "Cancel the currently running sandboxed command in a session.",
    inputSchema: { sessionId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId }) => response({ cancelled: runner.cancel(sessionId) }));

  server.registerTool("agent_run", {
    description: "Run OpenRouter or Gemini as a coding agent over the same confined session tools.",
    inputSchema: {
      sessionId: z.string().uuid(),
      provider: z.enum(["openrouter", "gemini"]),
      goal: z.string().min(1),
      model: z.string().min(1).optional(),
      maxSteps: z.number().int().min(1).max(64).default(16),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ sessionId, provider, goal, model, maxSteps }) =>
    sessions.runActivity(sessionId, "agent", async () => {
      if (provider === "openrouter") {
        return response(await runOpenRouter(config, agentTools, sessionId, goal, model, maxSteps));
      }
      return response(await runGemini(config, agentTools, sessionId, goal, model, maxSteps));
    }));

  return server;
}
