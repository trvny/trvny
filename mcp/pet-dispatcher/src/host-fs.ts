import { open, opendir, realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { AuthorityPolicy } from "./authority.js";
import type { HostFsCall, HostFsOp } from "./remote-protocol.js";
import { utf8Prefix } from "./workspace-fs.js";

// Read-only host filesystem access for the owner route. Every path is resolved (symlinks, junctions, 8.3 names) and then
// judged by AuthorityPolicy.evaluatePath on BOTH the resolved target and the spelling the caller used. Honest limits:
// realpath-then-open leaves a TOCTOU window for someone who can already write inside a granted root, and a hard link to
// a floored file cannot be told apart from an ordinary file.

const MAX_LIST_ENTRIES = 300;
const DEFAULT_READ_BYTES = 16 * 1_024;
const MAX_RESULT_BYTES = 80 * 1_024;

export type HostFsOpResult =
  | { op: "read"; path: string; content: string; truncated: boolean; bytes: number }
  | { op: "list"; path: string; entries: { name: string; type: string }[]; hidden: number; truncated: boolean }
  | { op: "stat"; path: string; type: string; size: number; modifiedAt: string }
  | { op: HostFsOp["op"]; path: string; error: string };

function refusal(op: HostFsOp["op"], path: string, reason: string): HostFsOpResult {
  return { op, path, error: reason.slice(0, 300) };
}

/** Resolves `input` to {lexical, canonical} or an error. Only absolute Windows paths are accepted. */
async function resolveOperand(policy: AuthorityPolicy, input: string, mode: "read"): Promise<{ lexical: string; canonical: string } | string> {
  if (!win32.isAbsolute(input) || /^[A-Za-z]:(?![\\/])/u.test(input)) return "path must be an absolute Windows path";
  const lexical = win32.normalize(input);
  const lexicalVerdict = policy.evaluatePath(lexical, mode, lexical);
  // The lexical spelling alone is already enough to refuse (device paths, streams, reserved names, floor, outside roots).
  if (!lexicalVerdict.allowed) return lexicalVerdict.reason ?? "path is not allowed";
  let canonical: string;
  try { canonical = await realpath(lexical); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "no such file or directory" : "path cannot be resolved"; }
  const verdict = policy.evaluatePath(canonical, mode, lexical);
  return verdict.allowed ? { lexical, canonical } : verdict.reason ?? "path is not allowed";
}

async function readOne(policy: AuthorityPolicy, op: Extract<HostFsOp, { op: "read" }>, budget: number): Promise<HostFsOpResult> {
  const target = await resolveOperand(policy, op.path, "read");
  if (typeof target === "string") return refusal("read", op.path, target);
  const limit = Math.max(0, Math.min(op.maxBytes ?? DEFAULT_READ_BYTES, 65_536, budget));
  try {
    const handle = await open(target.canonical, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) return refusal("read", op.path, "path is not a file");
      const buffer = Buffer.alloc(Math.min(info.size, limit + 4));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const content = utf8Prefix(buffer.subarray(0, bytesRead), limit);
      const bytes = Buffer.byteLength(content, "utf8");
      return { op: "read", path: op.path, content, bytes, truncated: info.size > bytes };
    } finally { await handle.close(); }
  } catch (error) {
    return refusal("read", op.path, error instanceof Error ? error.message.replace(/[A-Za-z]:\\[^\s'"]*/gu, "<path>") : "read failed");
  }
}

async function listOne(policy: AuthorityPolicy, op: Extract<HostFsOp, { op: "list" }>): Promise<HostFsOpResult> {
  const target = await resolveOperand(policy, op.path, "read");
  if (typeof target === "string") return refusal("list", op.path, target);
  const entries: { name: string; type: string }[] = [];
  let hidden = 0;
  let truncated = false;
  try {
    const directory = await opendir(target.canonical);
    try {
      for await (const entry of directory) {
        if (entries.length >= MAX_LIST_ENTRIES) { truncated = true; break; }
        // Children the floor denies are not revealed; a symlink/junction child is judged by where it leads.
        const lexicalChild = win32.join(target.lexical, entry.name);
        let verdict = policy.evaluatePath(win32.join(target.canonical, entry.name), "read", lexicalChild);
        if (verdict.allowed && entry.isSymbolicLink()) {
          try { verdict = policy.evaluatePath(await realpath(lexicalChild), "read", lexicalChild); } catch { verdict = { allowed: false }; }
        }
        if (!verdict.allowed) { hidden += 1; continue; }
        entries.push({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other" });
      }
    } finally { await directory.close().catch(() => undefined); }
  } catch (error) {
    return refusal("list", op.path, error instanceof Error ? error.message.replace(/[A-Za-z]:\\[^\s'"]*/gu, "<path>") : "list failed");
  }
  return { op: "list", path: op.path, entries, hidden, truncated };
}

async function statOne(policy: AuthorityPolicy, op: Extract<HostFsOp, { op: "stat" }>): Promise<HostFsOpResult> {
  const target = await resolveOperand(policy, op.path, "read");
  if (typeof target === "string") return refusal("stat", op.path, target);
  try {
    const info = await stat(target.canonical);
    return { op: "stat", path: op.path, type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other", size: info.size, modifiedAt: info.mtime.toISOString() };
  } catch { return refusal("stat", op.path, "path cannot be read"); }
}

/** Runs the ops in order; the total of read bytes stays under the callback budget. Never throws for a refused op. */
export async function runHostFs(policy: AuthorityPolicy, call: HostFsCall): Promise<{ results: HostFsOpResult[]; truncated: boolean }> {
  const results: HostFsOpResult[] = [];
  let remaining = MAX_RESULT_BYTES;
  let truncated = false;
  for (const op of call.ops) {
    if (op.op === "read") {
      if (remaining <= 0) { results.push(refusal("read", op.path, "result budget exhausted")); truncated = true; continue; }
      const result = await readOne(policy, op, remaining);
      if ("bytes" in result) { remaining -= result.bytes; truncated ||= result.truncated; }
      results.push(result);
    } else if (op.op === "list") {
      const result = await listOne(policy, op);
      if ("truncated" in result) truncated ||= result.truncated;
      results.push(result);
    } else {
      results.push(await statOne(policy, op));
    }
  }
  return { results, truncated };
}
