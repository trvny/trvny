import { execFile } from "node:child_process";
import { access, copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "../src/config.js";
import { localRuntimePaths, migrateDispatcherConfig, type LocalRuntimePaths } from "../src/local-runtime.js";

const execFileAsync = promisify(execFile);

export interface InstallLocalRuntimeOptions {
  sourceRoot: string;
  installRoot: string;
  dcRoot: string;
  workspaceRoot: string;
  repoUrl: string;
  build?: boolean;
  installDependencies?: boolean;
  registerStartup?: boolean;
  legacyConfigPath?: string;
  legacyJournalPath?: string;
  legacySecretsRoot?: string;
  keepReleases?: number;
}

export interface InstallLocalRuntimeResult {
  paths: LocalRuntimePaths;
  sourceCommit: string;
  releaseRoot: string;
}
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

async function run(file: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

async function runNpm(args: string[], cwd: string): Promise<string> {
  if (process.platform === "win32") {
    return run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd", ...args], cwd);
  }
  return run("npm", args, cwd);
}

async function copyIfPresent(source: string, target: string): Promise<void> {
  if (await exists(source)) await copyFile(source, target);
}

async function ensureMirror(mirror: string, repoUrl: string): Promise<void> {
  if (await exists(join(mirror, "HEAD"))) {
    await run("git", ["-C", mirror, "remote", "set-url", "origin", repoUrl]);
    await run("git", ["-C", mirror, "fetch", "--prune", "origin", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"]);
    return;
  }
  await mkdir(dirname(mirror), { recursive: true });
  await run("git", ["clone", "--mirror", repoUrl, mirror]);
}

async function copyDpapiSecrets(sourceRoot: string | undefined, targetRoot: string): Promise<void> {
  if (!sourceRoot || !await exists(sourceRoot)) return;
  await mkdir(targetRoot, { recursive: true });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".dpapi")) continue;
    const target = join(targetRoot, entry.name);
    if (!await exists(target)) await copyFile(join(sourceRoot, entry.name), target);
  }
}
async function migrateConfig(options: InstallLocalRuntimeOptions, paths: LocalRuntimePaths): Promise<void> {
  const sourcePath = await exists(paths.configPath) ? paths.configPath
    : options.legacyConfigPath && await exists(options.legacyConfigPath) ? options.legacyConfigPath
      : join(options.sourceRoot, "dispatcher.config.example.json");
  const raw = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  const migrated = migrateDispatcherConfig(raw, {
    paths,
    dcRoot: options.dcRoot,
    workspaceRoot: options.workspaceRoot,
  });
  await mkdir(paths.configRoot, { recursive: true });
  const temporary = `${paths.configPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  await loadConfig(temporary);
  await rename(temporary, paths.configPath);
}

async function migrateJournal(sourcePath: string | undefined, targetPath: string): Promise<void> {
  if (await exists(targetPath) || !sourcePath || !await exists(sourcePath)) return;
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function publishBin(sourceRoot: string, paths: LocalRuntimePaths): Promise<void> {
  await mkdir(paths.binRoot, { recursive: true });
  for (const name of ["pet-dispatcher-launch.ps1", "pet-dispatcher-secrets.ps1"]) {
    await copyFile(join(sourceRoot, "scripts", name), join(paths.binRoot, name));
  }
}
async function publishRelease(options: InstallLocalRuntimeOptions, paths: LocalRuntimePaths, sourceCommit: string): Promise<string> {
  if (options.build !== false) await runNpm(["run", "build"], options.sourceRoot);
  const releaseRoot = join(paths.releasesRoot, sourceCommit);
  if (await exists(releaseRoot)) return releaseRoot;
  const staging = `${releaseRoot}.staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await cp(join(options.sourceRoot, "dist"), join(staging, "dist"), { recursive: true });
    await copyFile(join(options.sourceRoot, "package.json"), join(staging, "package.json"));
    await copyIfPresent(join(options.sourceRoot, "package-lock.json"), join(staging, "package-lock.json"));
    if (options.installDependencies !== false) {
      await runNpm(["ci", "--omit=dev", "--no-audit", "--no-fund"], staging);
    }
    await mkdir(paths.releasesRoot, { recursive: true });
    await rename(staging, releaseRoot);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return releaseRoot;
}

async function writeCurrentManifest(paths: LocalRuntimePaths, sourceCommit: string, releaseRoot: string): Promise<void> {
  const manifest = { version: 1, sourceCommit, releaseRoot, nodePath: process.execPath, installedAt: new Date().toISOString() };
  await mkdir(paths.appRoot, { recursive: true });
  const temporary = `${paths.currentManifest}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, paths.currentManifest);
}
async function pruneReleases(paths: LocalRuntimePaths, activeRelease: string, keep: number): Promise<void> {
  if (!await exists(paths.releasesRoot)) return;
  const entries = await readdir(paths.releasesRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.includes(".staging-"));
  const keepNames = new Set([activeRelease.split(/[\\/]/u).at(-1) ?? ""]);
  for (const entry of directories.sort((a, b) => b.name.localeCompare(a.name)).slice(0, Math.max(keep, 1))) keepNames.add(entry.name);
  for (const entry of directories) {
    if (!keepNames.has(entry.name)) await rm(join(paths.releasesRoot, entry.name), { recursive: true, force: true });
  }
}

export function windowsStartupCommand(powershell: string, launcher: string): string {
  for (const value of [powershell, launcher]) {
    if (!value || /["\r\n]/u.test(value)) throw new Error("invalid Windows startup path");
  }
  return `"${powershell}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${launcher}"`;
}

async function registerStartup(paths: LocalRuntimePaths): Promise<void> {
  if (process.platform !== "win32") throw new Error("Pet Dispatcher startup registration is Windows-only");
  const powershell = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const launcher = join(paths.binRoot, "pet-dispatcher-launch.ps1");
  const command = windowsStartupCommand(powershell, launcher);
  await run("reg.exe", ["add", String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "PetDispatcher", "/t", "REG_SZ", "/d", command, "/f"]);
}

export async function installLocalRuntime(options: InstallLocalRuntimeOptions): Promise<InstallLocalRuntimeResult> {
  const paths = localRuntimePaths(resolve(options.installRoot));
  const dirty = await run("git", ["-C", options.sourceRoot, "status", "--porcelain"]);
  if (dirty) throw new Error("refusing to install Pet Dispatcher from a dirty source tree");
  const sourceCommit = await run("git", ["-C", options.sourceRoot, "rev-parse", "HEAD"]);
  await Promise.all([mkdir(paths.stateRoot, { recursive: true }), mkdir(paths.secretsRoot, { recursive: true }), mkdir(paths.logsRoot, { recursive: true })]);
  const releaseRoot = await publishRelease(options, paths, sourceCommit);
  await ensureMirror(paths.repoMirror, options.repoUrl);
  await migrateConfig(options, paths);
  await migrateJournal(options.legacyJournalPath, paths.journalPath);
  await copyDpapiSecrets(options.legacySecretsRoot, paths.secretsRoot);
  await publishBin(options.sourceRoot, paths);
  await writeCurrentManifest(paths, sourceCommit, releaseRoot);
  if (options.registerStartup) await registerStartup(paths);
  await pruneReleases(paths, releaseRoot, options.keepReleases ?? 2);
  return { paths, sourceCommit, releaseRoot };
}

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("local Pet Dispatcher installation is Windows-only");
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const home = homedir();
  const dcRoot = join(home, "dir", ".dc");
  const installRoot = process.env.PET_DISPATCHER_INSTALL_ROOT ?? join(home, ".local", "share", "pet-dispatcher");
  const repoUrl = await run("git", ["-C", sourceRoot, "remote", "get-url", "origin"]);
  const noStartup = process.argv.includes("--no-startup");
  const result = await installLocalRuntime({
    sourceRoot, installRoot, dcRoot, workspaceRoot: join(dcRoot, "pet-dispatcher-workspace"), repoUrl,
    legacyConfigPath: join(dcRoot, "pet-dispatcher", "dispatcher.live.json"),
    legacyJournalPath: join(dcRoot, "pet-dispatcher", "remote-journal.json"),
    legacySecretsRoot: join(dcRoot, ".secrets", "pet-dispatcher"),
    registerStartup: !noStartup,
  });
  process.stdout.write(`${JSON.stringify({ installed: true, root: result.paths.root, release: result.sourceCommit })}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
