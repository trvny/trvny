import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, win32 } from "node:path";

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function validateRelativePath(input: string): string {
  if (!input || input.includes("\0")) throw new Error("path must be a non-empty relative path");
  if (isAbsolute(input) || win32.isAbsolute(input) || /^[a-zA-Z]:/.test(input)) {
    throw new Error("absolute, drive-qualified and UNC paths are not allowed");
  }
  return input;
}

export async function canonicalRoot(root: string): Promise<string> {
  return realpath(resolve(root));
}

export async function resolveExisting(root: string, input: string): Promise<string> {
  validateRelativePath(input);
  const canonical = await canonicalRoot(root);
  const lexical = resolve(canonical, input);
  if (!isInside(canonical, lexical)) throw new Error("path escapes the session workspace");
  const target = await realpath(lexical);
  if (!isInside(canonical, target)) throw new Error("resolved path escapes the session workspace");
  return target;
}

export async function resolveForCreate(root: string, input: string): Promise<string> {
  validateRelativePath(input);
  const canonical = await canonicalRoot(root);
  const lexical = resolve(canonical, input);
  if (!isInside(canonical, lexical) || lexical === canonical) {
    throw new Error("target escapes or replaces the session workspace root");
  }
  const parent = await realpath(dirname(lexical));
  if (!isInside(canonical, parent)) throw new Error("target parent escapes the session workspace");
  return resolve(parent, basename(lexical));
}

export function assertInside(root: string, target: string): void {
  if (!isInside(resolve(root), resolve(target))) throw new Error("path escapes the session workspace");
}
