import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import { createInterface } from "node:readline";
import { WindowsJobGuard } from "../src/windows-job-guard.js";

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child did not exit")), timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function line(child: ChildProcessWithoutNullStreams): Promise<string> {
  const reader = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child produced no line")), 5_000);
    reader.once("line", (value) => { clearTimeout(timer); reader.close(); resolve(value); });
    child.once("error", reject);
  });
}

test("Windows Job Object kill removes descendants, not only the wrapper", { skip: process.platform !== "win32" }, async () => {
  const guard = await WindowsJobGuard.create(100);
  assert.ok(guard);
  const script = [
    "process.stdin.once('data',()=>{",
    " const {spawn}=require('node:child_process');",
    " const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
    " console.log(c.pid);",
    " setInterval(()=>{},1000);",
    "});",
  ].join("");
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  try {
    await guard.attach("tree", child.pid!, { memoryMiB: 512, processLimit: 8 });
    child.stdin.write("go\n");
    const descendantPid = Number(await line(child));
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
    assert.equal(alive(descendantPid), true);
    await guard.kill("tree", "cancelled");
    await waitForExit(child);
    for (let attempt = 0; attempt < 50 && alive(descendantPid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(alive(descendantPid), false);
    const stats = await guard.release("tree");
    assert.equal(stats?.killReason, "cancelled");
  } finally {
    child.kill();
    await guard.close();
  }
});

test("Windows Job Object memory cap terminates a runaway process", { skip: process.platform !== "win32" }, async () => {
  const guard = await WindowsJobGuard.create(100);
  assert.ok(guard);
  const script = [
    "process.stdin.once('data',()=>{",
    " const held=[];",
    " setInterval(()=>held.push(Buffer.alloc(16*1024*1024,1)),15);",
    "});",
  ].join("");
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  try {
    await guard.attach("memory", child.pid!, { memoryMiB: 256, processLimit: 4 });
    child.stdin.write("go\n");
    const code = await waitForExit(child, 12_000);
    assert.notEqual(code, 0);
    const stats = await guard.release("memory");
    assert.equal(stats?.killReason, "memory_limit");
    assert.ok((stats?.peakMemoryBytes ?? 0) > 128 * 1_048_576);
  } finally {
    child.kill();
    await guard.close();
  }
});

test("closing the guardian kills guarded work after worker-style shutdown", { skip: process.platform !== "win32" }, async () => {
  const guard = await WindowsJobGuard.create(100);
  assert.ok(guard);
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  await guard.attach("shutdown", child.pid!, { memoryMiB: 512, processLimit: 4 });
  await guard.close();
  await waitForExit(child);
  assert.equal(alive(child.pid!), false);
});
