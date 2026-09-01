import type { HostGit } from "./host-git.js";
import type { NetworkBroker } from "./network.js";
import type { CommandRunner } from "./sandbox.js";
import type { SessionManager } from "./sessions.js";
import { listWorkspace, patchWorkspace, readWorkspace, writeWorkspace } from "./workspace-fs.js";

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const agentToolDefinitions: AgentToolDefinition[] = [
  {
    name: "list_files",
    description: "List one directory inside the assigned session workspace.",
    parameters: { type: "object", properties: { path: { type: "string", default: "." } }, additionalProperties: false },
  },
  {
    name: "read_file",
    description: "Read one UTF-8 text file inside the assigned session workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "write_file",
    description: "Create or replace one UTF-8 text file inside the assigned session workspace.",
    parameters: {
      type: "object", properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"], additionalProperties: false,
    },
  },
  {
    name: "patch_file",
    description: "Replace one unique text fragment in a file inside the assigned session workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } },
      required: ["path", "oldText", "newText"], additionalProperties: false,
    },
  },
  {
    name: "exec",
    description: "Run an argv-style developer command inside the session sandbox. No shell is implied and sockets remain blocked.",
    parameters: {
      type: "object",
      properties: {
        argv: { type: "array", items: { type: "string" }, minItems: 1 },
        cwd: { type: "string", default: "." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
      },
      required: ["argv"], additionalProperties: false,
    },
  },
  {
    name: "git_status",
    description: "Read Git status through the dispatcher host adapter bound to the session repository.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "git_diff",
    description: "Read a Git diff through the confined host adapter.",
    parameters: { type: "object", properties: { staged: { type: "boolean" }, paths: { type: "array", items: { type: "string" } } }, additionalProperties: false },
  },
  {
    name: "git_add",
    description: "Stage workspace-relative paths using the confined host Git adapter.",
    parameters: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["paths"], additionalProperties: false },
  },
  {
    name: "git_commit",
    description: "Commit staged changes as GPTomek with hooks and signing disabled.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false },
  },
  {
    name: "http_fetch",
    description: "Fetch an allowlisted HTTPS URL through the dispatcher network broker. Direct sandbox sockets stay blocked.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" }, method: { type: "string", enum: ["GET", "HEAD"] }, accept: { type: "string" } },
      required: ["url"], additionalProperties: false,
    },
  },
];
export class AgentTools {
  constructor(
    readonly sessions: SessionManager,
    readonly runner: CommandRunner,
    readonly broker: NetworkBroker,
    readonly git: HostGit,
  ) {}

  async execute(sessionId: string, name: string, raw: unknown): Promise<unknown> {
    const args = (raw ?? {}) as Record<string, unknown>;
    this.sessions.get(sessionId);
    switch (name) {
      case "list_files":
        return this.sessions.runHostOperation(sessionId, (locked) => listWorkspace(locked, String(args.path ?? ".")));
      case "read_file":
        return this.sessions.runHostOperation(sessionId, async (locked) => ({ content: await readWorkspace(locked, String(args.path ?? "")) }));
      case "write_file":
        await this.sessions.runHostOperation(sessionId, (locked) =>
          writeWorkspace(locked, String(args.path ?? ""), String(args.content ?? "")));
        return { ok: true };
      case "patch_file":
        await this.sessions.runHostOperation(sessionId, (locked) =>
          patchWorkspace(locked, String(args.path ?? ""), String(args.oldText ?? ""), String(args.newText ?? "")));
        return { ok: true };
      case "exec": {
        const argv = Array.isArray(args.argv) ? args.argv.map(String) : [];
        let timeoutMs: number | undefined;
        if (args.timeoutMs !== undefined) {
          const value = Number(args.timeoutMs);
          if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1_000 || value > 3_600_000) {
            throw new Error("timeoutMs must be an integer between 1000 and 3600000");
          }
          timeoutMs = value;
        }
        return this.runner.exec(sessionId, argv, String(args.cwd ?? "."), timeoutMs);
      }
      case "git_status": return this.git.status(sessionId);
      case "git_diff":
        return this.git.diff(sessionId, args.staged === true, Array.isArray(args.paths) ? args.paths.map(String) : []);
      case "git_add":
        return this.git.add(sessionId, Array.isArray(args.paths) ? args.paths.map(String) : []);
      case "git_commit": return this.git.commit(sessionId, String(args.message ?? ""));
      case "http_fetch":
        return this.broker.request(this.sessions.get(sessionId), {
          url: String(args.url ?? ""),
          method: args.method === "HEAD" ? "HEAD" : "GET",
          accept: typeof args.accept === "string" ? args.accept : undefined,
        });
      default: throw new Error(`unknown agent tool: ${name}`);
    }
  }
}
