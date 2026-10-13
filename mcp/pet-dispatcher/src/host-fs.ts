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
const MAX_RESULT_BYTES = 72 * 1_024;   // serialized JSON of all results; the executor callback limit is 96 KiB

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

const REFUSAL_RESERVE_BYTES = 220;   // a refusal with a path cut to 120 characters
const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Shrinks a result until its serialized form fits `room` bytes (JSON escaping can double the decoded size). */
function fit(result: HostFsOpResult, room: number): HostFsOpResult | undefined {
  if (jsonBytes(result) <= room) return result;
  if ("content" in result) {
    let content = result.content;
    while (content.length > 0) {
      content = utf8Prefix(Buffer.from(content, "utf8"), Math.floor(Buffer.byteLength(content, "utf8") * 0.7));
      const shrunk = { ...result, content, bytes: Buffer.byteLength(content, "utf8"), truncated: true };
      if (jsonBytes(shrunk) <= room) return shrunk;
    }
    return undefined;
  }
  if ("entries" in result) {
    const entries = result.entries.slice();
    while (entries.length > 0) {
      entries.length = Math.floor(entries.length * 0.7);
      const shrunk = { ...result, entries, truncated: true };
      if (jsonBytes(shrunk) <= room) return shrunk;
    }
  }
  return undefined;
}

/**
 * Runs the ops in order. The serialized results stay under MAX_RESULT_BYTES (below the executor's callback limit), so a
 * call never fails the result callback: what does not fit is trimmed (`truncated`) or answered with "result budget
 * exhausted". Never throws for a refused op.
 */
export async function runHostFs(policy: AuthorityPolicy, call: HostFsCall): Promise<{ results: HostFsOpResult[]; truncated: boolean }> {
  const results: HostFsOpResult[] = [];
  let used = 2;   // the surrounding array
  let truncated = false;
  for (const [index, op] of call.ops.entries()) {
    // Every op gets an answer: room for a short refusal is reserved for each op still to come.
    const room = MAX_RESULT_BYTES - used - 1 - (call.ops.length - index - 1) * REFUSAL_RESERVE_BYTES;
    const budgetRefusal = refusal(op.op, op.path.slice(0, 120), "result budget exhausted");
    if (room < REFUSAL_RESERVE_BYTES) { results.push(budgetRefusal); used += jsonBytes(budgetRefusal) + 1; truncated = true; continue; }
    const raw = op.op === "read" ? await readOne(policy, op, Math.max(1, Math.floor(room / 2)))
      : op.op === "list" ? await listOne(policy, op) : await statOne(policy, op);
    const fitted = fit(raw, room);
    if (!fitted) { results.push(budgetRefusal); used += jsonBytes(budgetRefusal) + 1; truncated = true; continue; }
    if (fitted !== raw) truncated = true;
    if ("truncated" in fitted && fitted.truncated) truncated = true;
    results.push(fitted);
    used += jsonBytes(fitted) + 1;
  }
  return { results, truncated };
}
