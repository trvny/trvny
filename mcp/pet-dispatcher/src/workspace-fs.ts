import { mkdir, open, opendir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Session } from "./sessions.js";
import { resolveExisting, resolveExistingEntry, resolveForCreate, resolveForWrite } from "./path-guard.js";

const MAX_DIRECTORY_ENTRIES = 500;

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
