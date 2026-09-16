import { mkdir, open, opendir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Session } from "./sessions.js";
import { resolveExisting, resolveExistingEntry, resolveForCreate, resolveForWrite } from "./path-guard.js";

const MAX_DIRECTORY_ENTRIES = 500;
const DEFAULT_READ_MANY_FILE_BYTES = 32 * 1_024;
const DEFAULT_READ_MANY_TOTAL_BYTES = 64 * 1_024;
const DEFAULT_DISCOVERY_BYTES = 48 * 1_024;

function slash(path: string): string { return path.replaceAll("\\", "/"); }

function utf8Prefix(buffer: Buffer, maxBytes: number): string {
  const limit = Math.min(buffer.length, Math.max(0, maxBytes));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = limit; end >= Math.max(0, limit - 4); end -= 1) {
    try { return decoder.decode(buffer.subarray(0, end)); } catch { /* trim an incomplete trailing code point */ }
  }
  return buffer.subarray(0, limit).toString("utf8");
}

function arrayBytesAfterPush<T>(items: T[], item: T): number {
  const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
  const existing = items.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value), "utf8"), 0);
  return 2 + existing + itemBytes + Math.max(0, items.length);
}

export async function listWorkspace(session: Session, path = "."): Promise<object[]> {
  const target = await resolveExisting(session.root, path);
  const directory = await opendir(target);
  const entries: object[] = [];
  let truncated = false;
  try {
    for await (const entry of directory) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
      });
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  if (truncated) entries.push({ truncated: true, limit: MAX_DIRECTORY_ENTRIES });
  return entries;
}

export async function statWorkspace(session: Session, path: string): Promise<object> {
  const target = await resolveExisting(session.root, path);
  const info = await stat(target);
  return {
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
  };
}

export async function readWorkspace(session: Session, path: string, maxBytes = 1_048_576): Promise<string> {
  const target = await resolveExisting(session.root, path);
  const handle = await open(target, "r");
  try {
    const info = await handle.stat();
    if (info.size > maxBytes) throw new Error(`file exceeds ${maxBytes} byte read limit`);
    return (await handle.readFile()).toString("utf8");
  } finally { await handle.close(); }
}

export interface ReadManyOptions { maxBytesPerFile?: number; maxTotalBytes?: number }
export interface ReadManyFile { path: string; content?: string; truncated?: boolean; error?: string }

export async function readManyWorkspace(session: Session, paths: string[], options: ReadManyOptions = {}) {
  if (paths.length < 1 || paths.length > 32) throw new Error("fs.readMany accepts 1-32 paths");
  const maxBytesPerFile = Math.min(65_536, Math.max(1, options.maxBytesPerFile ?? DEFAULT_READ_MANY_FILE_BYTES));
  const maxTotalBytes = Math.min(81_920, Math.max(1, options.maxTotalBytes ?? DEFAULT_READ_MANY_TOTAL_BYTES));
  const files: ReadManyFile[] = [];
  let totalBytes = 0;
  let truncated = false;
  for (const path of paths) {
    const remaining = maxTotalBytes - totalBytes;
    if (remaining <= 0) {
      files.push({ path, content: "", truncated: true });
      truncated = true;
      continue;
    }
    try {
      const target = await resolveExisting(session.root, path);
      const handle = await open(target, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error("path is not a file");
        const limit = Math.min(maxBytesPerFile, remaining);
        const buffer = Buffer.alloc(Math.min(info.size, limit + 4));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const source = buffer.subarray(0, bytesRead);
        const content = utf8Prefix(source, limit);
        const used = Buffer.byteLength(content, "utf8");
        const fileTruncated = info.size > used;
        files.push({ path, content, truncated: fileTruncated });
        totalBytes += used;
        truncated ||= fileTruncated;
      } finally { await handle.close(); }
    } catch (error) {
      files.push({ path, error: (error instanceof Error ? error.message : String(error)).slice(0, 512) });
    }
  }
  return { files, totalBytes, truncated };
}

export interface TreeOptions { depth?: number; maxEntries?: number; maxBytes?: number }
export interface TreeEntry { path: string; type: "directory" | "file" | "symlink" | "other" }

export async function treeWorkspace(session: Session, path = ".", options: TreeOptions = {}) {
  const depth = Math.min(8, Math.max(0, options.depth ?? 2));
  const maxEntries = Math.min(1_000, Math.max(1, options.maxEntries ?? 250));
  const maxBytes = Math.min(65_536, Math.max(2, options.maxBytes ?? DEFAULT_DISCOVERY_BYTES));
  await resolveExisting(session.root, path);
  const entries: TreeEntry[] = [];
  let truncated = false;
  const visit = async (relative: string, level: number): Promise<void> => {
    if (entries.length >= maxEntries) { truncated = true; return; }
    const target = await resolveExisting(session.root, relative);
    const children = (await readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.length >= maxEntries) { truncated = true; return; }
      const childPath = relative === "." ? child.name : `${slash(relative)}/${child.name}`;
      const type = child.isDirectory() ? "directory" : child.isFile() ? "file" : child.isSymbolicLink() ? "symlink" : "other";
      const entry: TreeEntry = { path: slash(childPath), type };
      if (arrayBytesAfterPush(entries, entry) > maxBytes) { truncated = true; return; }
      entries.push(entry);
      if (child.isDirectory() && level < depth) await visit(childPath, level + 1);
      if (truncated) return;
    }
  };
  await visit(path, 0);
  return { entries, truncated, depth, limit: maxEntries, maxBytes };
}

export interface SearchOptions {
  query: string; path?: string; maxMatches?: number; maxFiles?: number; maxFileBytes?: number; maxDepth?: number; maxBytes?: number;
}

export async function searchWorkspace(session: Session, options: SearchOptions) {
  if (!options.query || options.query.length > 512) throw new Error("fs.search query must be 1-512 characters");
  const root = options.path ?? ".";
  const maxMatches = Math.min(200, Math.max(1, options.maxMatches ?? 50));
  const maxFiles = Math.min(1_000, Math.max(1, options.maxFiles ?? 250));
  const maxFileBytes = Math.min(1_048_576, Math.max(1, options.maxFileBytes ?? 131_072));
  const maxDepth = Math.min(12, Math.max(0, options.maxDepth ?? 6));
  const maxBytes = Math.min(65_536, Math.max(2, options.maxBytes ?? DEFAULT_DISCOVERY_BYTES));
  await resolveExisting(session.root, root);
  const matches: Array<{ path: string; line: number; preview: string }> = [];
  let filesScanned = 0;
  let skippedLargeFiles = 0;
  let truncated = false;
  const visit = async (relative: string, level: number): Promise<void> => {
    if (matches.length >= maxMatches || filesScanned >= maxFiles) { truncated = true; return; }
    const target = await resolveExisting(session.root, relative);
    const children = (await readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (matches.length >= maxMatches || filesScanned >= maxFiles) { truncated = true; return; }
      const childPath = relative === "." ? child.name : `${slash(relative)}/${child.name}`;
      if (child.isDirectory()) {
        if (level < maxDepth) await visit(childPath, level + 1);
        if (truncated) return;
        continue;
      }
      if (!child.isFile()) continue;
      filesScanned += 1;
      const fileTarget = await resolveExisting(session.root, childPath);
      const info = await stat(fileTarget);
      if (info.size > maxFileBytes) { skippedLargeFiles += 1; continue; }
      const content = await readWorkspace(session, childPath, maxFileBytes);
      const lines = content.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.includes(options.query)) continue;
        const match = { path: slash(childPath), line: index + 1, preview: line.slice(0, 240) };
        if (arrayBytesAfterPush(matches, match) > maxBytes) { truncated = true; return; }
        matches.push(match);
        if (matches.length >= maxMatches) { truncated = true; return; }
      }
    }
  };
  await visit(root, 0);
  return { matches, filesScanned, skippedLargeFiles, truncated, maxBytes };
}

export async function writeWorkspace(session: Session, path: string, content: string): Promise<void> {
  const target = await resolveForWrite(session.root, path);
  await writeFile(target, content, "utf8");
}

export async function patchWorkspace(session: Session, path: string, oldText: string, newText: string): Promise<void> {
  const target = await resolveExisting(session.root, path);
  const content = await readWorkspace(session, path);
  const first = content.indexOf(oldText);
  if (first < 0) throw new Error("patch text was not found");
  if (content.indexOf(oldText, first + oldText.length) >= 0) throw new Error("patch text is not unique");
  await writeFile(target, content.slice(0, first) + newText + content.slice(first + oldText.length), "utf8");
}

export async function mkdirWorkspace(session: Session, path: string): Promise<void> {
  const target = await resolveForCreate(session.root, path);
  await mkdir(target);
}

export async function moveWorkspace(session: Session, from: string, to: string): Promise<void> {
  const source = await resolveExistingEntry(session.root, from);
  const target = await resolveForCreate(session.root, to);
  await rename(source, target);
}

export async function deleteWorkspace(session: Session, path: string): Promise<void> {
  const target = await resolveExistingEntry(session.root, path);
  await rm(target, { recursive: true, force: false });
}
