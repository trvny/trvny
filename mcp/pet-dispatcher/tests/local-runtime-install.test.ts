import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installLocalRuntime, pruneReleases } from "../scripts/install-local-runtime.js";
import { localRuntimePaths } from "../src/local-runtime.js";
import { PROVIDER_CREDENTIAL_ENV_NAMES } from "../src/provider-credentials.js";

const execFileAsync = promisify(execFile);
const environmentPolicyFixture = {
  secretNamePattern: "TOKEN|KEY|SECRET|PASS|AUTH",
  sandboxPassthrough: [], sandboxReadonlyPathVariables: [], networkProfileSecrets: {},
};

async function writeEnvironmentPolicyFixture(source: string): Promise<void> {
  await writeFile(join(source, "environment-policy.json"), JSON.stringify(environmentPolicyFixture));
}

test("remote launcher strips inherited provider credentials before starting Node", async () => {
  const launcher = await readFile(new URL("../scripts/pet-dispatcher-start-worker.ps1", import.meta.url), "utf8");
  assert.equal(launcher.includes("provider-credential-env-names.json"), true);
  assert.equal(launcher.includes('Remove-Item -LiteralPath "Env:$([string]$name)"'), true);
  assert.equal(launcher.includes("& $nodePath $entry provider-credential"), false);
  assert.equal(launcher.includes("GetEnvironmentVariable($name, 'User')"), false);
});

test("local installer publishes runtime and migrates control state away from dc", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-local-install-"));
  const source = join(base, "source");
  const dcRoot = join(base, "dc");
  const installRoot = join(base, "local-share", "pet-dispatcher");
  const legacyRoot = join(dcRoot, "pet-dispatcher");
  const legacySecrets = join(dcRoot, ".secrets", "pet-dispatcher");
  try {
    await mkdir(join(source, "dist", "src"), { recursive: true });
    await mkdir(join(source, "scripts"), { recursive: true });
    await mkdir(legacySecrets, { recursive: true });
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(source, "dist", "src", "index.js"), "console.log('fixture')\n");
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "pet-fixture", version: "1.0.0" }));
    await writeEnvironmentPolicyFixture(source);
    await writeFile(join(source, "dispatcher.config.example.json"), JSON.stringify({ workspaceRoot: join(base, "dc", "workspace"), repositories: {}, workspaces: {}, toolRoots: [], networkProfiles: {} }));
    await writeFile(join(source, "scripts", "pet-dispatcher-start-worker.ps1"), "# launcher fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-supervise.js"), "// supervisor fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-secrets.ps1"), "# secrets fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-restart.ps1"), "# restart fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-wakeguard.ps1"), "# wakeguard fixture\n");
    await writeFile(join(source, "scripts", "windows-job-guard.ps1"), "# guard fixture\n");
    await execFileAsync("git", ["init", source]);
    await execFileAsync("git", ["-C", source, "add", "."]);
    await execFileAsync("git", ["-C", source, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "fixture"]);
    const legacyConfig = {
      workspaceRoot: join(dcRoot, "pet-dispatcher-workspace"), repositories: { trvny: join(dcRoot, "git", "trvny-main") },
      workspaces: { dc: dcRoot }, toolRoots: [], networkProfiles: {},
      defaultTimeoutMs: 120000, maxOutputBytes: 1048576, maxBrokerResponseBytes: 2097152,
      remote: { enabled: true, deviceId: "legion", accountId: "0".repeat(32), queueId: "1".repeat(32),
        controlPlaneUrl: "https://example.invalid", queueTokenEnv: "PET_DISPATCHER_QUEUE_TOKEN",
        signingSecretEnv: "PET_DISPATCHER_SIGNING_SECRET", pollIntervalMs: 5000, heartbeatIntervalMs: 5000,
        visibilityTimeoutMs: 1800000, journalPath: join(legacyRoot, "remote-journal.json") },
    };
    await writeFile(join(legacyRoot, "dispatcher.live.json"), JSON.stringify(legacyConfig));
    await writeFile(join(legacyRoot, "remote-journal.json"), "journal\n");
    await writeFile(join(legacySecrets, "PET_DISPATCHER_QUEUE_TOKEN.dpapi"), "queue-cipher");
    await writeFile(join(legacySecrets, "TASK_SIGNING_SECRET.dpapi"), "signing-cipher");

    const result = await installLocalRuntime({
      sourceRoot: source, installRoot, dcRoot, workspaceRoot: join(dcRoot, "pet-dispatcher-workspace"),
      repoUrl: source, build: false, installDependencies: false, registerStartup: false,
      legacyConfigPath: join(legacyRoot, "dispatcher.live.json"), legacyJournalPath: join(legacyRoot, "remote-journal.json"),
      legacySecretsRoot: legacySecrets,
    });
    const config = JSON.parse(await readFile(result.paths.configPath, "utf8")) as Record<string, any>;
    assert.equal(config.repositories.trvny, result.paths.repoMirror);
    assert.equal(config.remote.journalPath, result.paths.journalPath);
    assert.equal(config.environmentPolicyPath, result.paths.environmentPolicyPath);
    assert.deepEqual(JSON.parse(await readFile(result.paths.environmentPolicyPath, "utf8")), environmentPolicyFixture);
    assert.equal(await readFile(result.paths.journalPath, "utf8"), "journal\n");
    assert.equal(await readFile(join(result.paths.secretsRoot, "PET_DISPATCHER_QUEUE_TOKEN.dpapi"), "utf8"), "queue-cipher");
    assert.equal(await readFile(join(result.paths.binRoot, "pet-dispatcher-start-worker.ps1"), "utf8"), "# launcher fixture\n");
    assert.equal(await readFile(join(result.paths.binRoot, "pet-dispatcher-restart.ps1"), "utf8"), "# restart fixture\n");
    assert.deepEqual(JSON.parse(await readFile(join(result.paths.binRoot, "provider-credential-env-names.json"), "utf8")), PROVIDER_CREDENTIAL_ENV_NAMES);
    assert.equal((await execFileAsync("git", ["-C", result.paths.repoMirror, "rev-parse", "--is-bare-repository"])).stdout.trim(), "true");
    assert.ok((await stat(join(result.releaseRoot, "dist", "src", "index.js"))).isFile());
    assert.equal(await readFile(join(result.releaseRoot, "scripts", "windows-job-guard.ps1"), "utf8"), "# guard fixture\n");
    assert.ok((await stat(join(legacySecrets, "TASK_SIGNING_SECRET.dpapi"))).isFile(), "legacy secrets stay until live verification succeeds");
    const manifest = JSON.parse(await readFile(result.paths.currentManifest, "utf8")) as { sourceCommit: string; releaseRoot: string };
    assert.equal(manifest.sourceCommit, result.sourceCommit);
    assert.equal(manifest.releaseRoot, result.releaseRoot);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});


test("runtime mirror updates remote heads without pruning exported Pet refs", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-local-mirror-"));
  const source = join(base, "source");
  const installRoot = join(base, "install");
  try {
    await mkdir(join(source, "dist", "src"), { recursive: true });
    await mkdir(join(source, "scripts"), { recursive: true });
    await writeFile(join(source, "dist", "src", "index.js"), "console.log('fixture')\n");
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "pet-fixture", version: "1.0.0" }));
    await writeEnvironmentPolicyFixture(source);
    await writeFile(join(source, "dispatcher.config.example.json"), JSON.stringify({ workspaceRoot: join(base, "dc", "workspace"), repositories: {}, workspaces: {}, toolRoots: [], networkProfiles: {} }));
    for (const name of ["pet-dispatcher-start-worker.ps1", "pet-dispatcher-supervise.js", "pet-dispatcher-secrets.ps1", "pet-dispatcher-restart.ps1", "pet-dispatcher-wakeguard.ps1", "windows-job-guard.ps1"]) await writeFile(join(source, "scripts", name), "# fixture\n");
    await execFileAsync("git", ["init", source]);
    await execFileAsync("git", ["-C", source, "add", "."]);
    await execFileAsync("git", ["-C", source, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "one"]);
    const options = { sourceRoot: source, installRoot, dcRoot: join(base, "dc"), workspaceRoot: join(base, "dc", "workspace"), repoUrl: source,
      build: false, installDependencies: false, registerStartup: false };
    const first = await installLocalRuntime(options);
    const head = (await execFileAsync("git", ["-C", first.paths.repoMirror, "rev-parse", "HEAD"])).stdout.trim();
    const customPolicy = { ...environmentPolicyFixture, sandboxPassthrough: ["JAVA_HOME"] };
    await writeFile(first.paths.environmentPolicyPath, JSON.stringify(customPolicy));
    await execFileAsync("git", ["-C", first.paths.repoMirror, "update-ref", "refs/pet-dispatcher/keep-me", head]);
    await writeFile(join(source, "second.txt"), "two\n");
    await execFileAsync("git", ["-C", source, "add", "second.txt"]);
    await execFileAsync("git", ["-C", source, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "two"]);
    const second = await installLocalRuntime(options);
    const kept = (await execFileAsync("git", ["-C", second.paths.repoMirror, "rev-parse", "refs/pet-dispatcher/keep-me"])).stdout.trim();
    const updated = (await execFileAsync("git", ["-C", second.paths.repoMirror, "rev-parse", "HEAD"])).stdout.trim();
    assert.equal(kept, head);
    assert.notEqual(updated, head);
    assert.deepEqual(JSON.parse(await readFile(second.paths.environmentPolicyPath, "utf8")), customPolicy);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("release pruning keeps the newest installs by date and the active release, never by name", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-prune-"));
  try {
    const paths = localRuntimePaths(base);
    // Names are commit-hash-like: alphabetical order is the reverse of install order here.
    const installs = [["zz-oldest", 1], ["bb-old", 2], ["mm-recent", 3], ["aa-newest", 4]] as const;
    for (const [name, day] of installs) {
      await mkdir(join(paths.releasesRoot, name), { recursive: true });
      await utimes(join(paths.releasesRoot, name), new Date(2026, 9, day), new Date(2026, 9, day));
    }
    await pruneReleases(paths, join(paths.releasesRoot, "bb-old"), 2);
    assert.deepEqual((await readdir(paths.releasesRoot)).sort(), ["aa-newest", "bb-old", "mm-recent"]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("release pruning sweeps quarantine leftovers and never counts them as releases", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-prune-q-"));
  try {
    const paths = localRuntimePaths(base);
    await mkdir(join(paths.releasesRoot, "aa-active"), { recursive: true });
    // Newest by mtime: if it counted as a release it would take the only keep slot.
    await mkdir(join(paths.releasesRoot, "zz-gone.pruning-1-2", "dist"), { recursive: true });
    await utimes(join(paths.releasesRoot, "aa-active"), new Date(2026, 9, 1), new Date(2026, 9, 1));
    await pruneReleases(paths, join(paths.releasesRoot, "aa-active"), 1);
    assert.deepEqual(await readdir(paths.releasesRoot), ["aa-active"]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("startup command uses native Windows quoting", async () => {
  const module = await import("../scripts/install-local-runtime.js");
  assert.equal(module.windowsStartupCommand(String.raw`C:\Program Files\Windows\wscript.exe`, String.raw`C:\Users\travn\.local\share\pet-dispatcher\bin\pet-dispatcher-supervise.js`),
    '"C:\\Program Files\\Windows\\wscript.exe" //B //Nologo "C:\\Users\\travn\\.local\\share\\pet-dispatcher\\bin\\pet-dispatcher-supervise.js" /logon');
});

test("supervisor starts the one-shot worker launcher with SW_HIDE and holds a singleton lock", async () => {
  const supervisor = await readFile(new URL("../scripts/pet-dispatcher-supervise.js", import.meta.url), "utf8");
  assert.match(supervisor, /pet-dispatcher-start-worker\.ps1/u);
  assert.match(supervisor, /shell\.Run\(command, 0, true\)/u);
  assert.match(supervisor, /supervisor\.lock/u);
});

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for supervisor state");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

test("supervisor ignores a stale pid, restarts a dead worker and refuses a second instance", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-supervisor-"));
  const bin = join(base, "bin");
  const supervisorPath = join(bin, "pet-dispatcher-supervise.js");
  const pidPath = join(base, "state", "worker.pid");
  const wscript = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "wscript.exe");
  const env = { ...process.env, PET_DISPATCHER_SUPERVISOR_POLL_MS: "500", PET_DISPATCHER_SUPERVISOR_RETRY_MS: "500", FIXTURE_NODE: process.execPath };
  const spawned: number[] = [];
  const workers = new Set<number>();
  const readWorker = async (): Promise<number | undefined> => {
    try {
      const pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
      return pid > 0 && alive(pid) ? pid : undefined;
    } catch { return undefined; }
  };
  try {
    await mkdir(bin, { recursive: true });
    await writeFile(supervisorPath, await readFile(new URL("../scripts/pet-dispatcher-supervise.js", import.meta.url)));
    // Stand-in for the real launcher: a sleeping node whose command line ends in
    // "<root>\app\releases\...\index.js remote".
    await writeFile(join(bin, "pet-dispatcher-start-worker.ps1"), [
      "param([string]$Root)",
      "New-Item -ItemType Directory -Path (Join-Path $Root 'state') -Force | Out-Null",
      "$entry = Join-Path $Root 'app\\releases\\fixture\\index.js'",
      "$p = Start-Process -FilePath $env:FIXTURE_NODE -ArgumentList @('-e', '\"setTimeout(function(){},120000)\"', $entry, 'remote') -WindowStyle Hidden -PassThru",
      "Set-Content -LiteralPath (Join-Path $Root 'state\\worker.pid') -Value $p.Id -Encoding ascii -NoNewline",
      "",
    ].join("\r\n"));
    // A stale pid file can point at an unrelated node that also runs "index.js remote" (the
    // pid file survives reboots, PIDs get reused). The supervisor must not adopt it.
    const foreign = spawn(process.execPath, ["-e", "setTimeout(function(){},120000)", "index.js", "remote"], { windowsHide: true, stdio: "ignore" });
    workers.add(foreign.pid ?? 0);
    await mkdir(join(base, "state"), { recursive: true });
    await writeFile(pidPath, String(foreign.pid));
    const first = spawn(wscript, ["//B", "//Nologo", supervisorPath], { env, windowsHide: true, stdio: "ignore" });
    spawned.push(first.pid ?? 0);
    const worker1 = await waitFor(async () => {
      const pid = await readWorker();
      return pid !== undefined && pid !== foreign.pid ? pid : undefined;
    }, 20_000);
    workers.add(worker1);
    assert.equal(alive(foreign.pid ?? 0), true, "the supervisor must leave an unrelated process alone");

    process.kill(worker1);
    const worker2 = await waitFor(async () => {
      const pid = await readWorker();
      return pid !== undefined && pid !== worker1 ? pid : undefined;
    }, 20_000);
    workers.add(worker2);

    const second = spawn(wscript, ["//B", "//Nologo", supervisorPath], { env, windowsHide: true, stdio: "ignore" });
    spawned.push(second.pid ?? 0);
    await waitFor(async () => second.exitCode === null ? undefined : second.exitCode, 10_000);
    assert.equal(alive(worker2), true, "a refused second supervisor must not touch the worker");
  } finally {
    for (const pid of spawned) if (pid) await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined);
    for (const pid of workers) if (alive(pid)) { try { process.kill(pid); } catch { /* already gone */ } }
    await rm(base, { recursive: true, force: true });
  }
});

test("worker launcher adopts a live unrecorded worker instead of starting a second one", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-adopt-"));
  const powershell = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    const entry = join(base, "app", "releases", "fixture", "index.js");
    await mkdir(join(base, "app", "releases", "fixture"), { recursive: true });
    await mkdir(join(base, "state"), { recursive: true });
    // Same shape as the real worker's command line: "<root>\app\releases\...\index.js remote", no pid file.
    worker = spawn(process.execPath, ["-e", "setTimeout(function(){},120000)", entry, "remote"], { windowsHide: true, stdio: "ignore" });
    await new Promise((resolveStart) => setTimeout(resolveStart, 500));
    const script = fileURLToPath(new URL("../scripts/pet-dispatcher-start-worker.ps1", import.meta.url));
    // Adoption happens before the manifest/secrets are read, so a bare root is enough.
    await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Root", base]);
    assert.equal(Number.parseInt(await readFile(join(base, "state", "worker.pid"), "utf8"), 10), worker.pid);
    assert.equal(alive(worker.pid ?? 0), true);
  } finally {
    if (worker?.pid && alive(worker.pid)) { try { process.kill(worker.pid); } catch { /* already gone */ } }
    await rm(base, { recursive: true, force: true });
  }
});

test("supervisor started with /logon waits before the first worker start", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-supervisor-logon-"));
  const bin = join(base, "bin");
  const supervisorPath = join(bin, "pet-dispatcher-supervise.js");
  const pidPath = join(base, "state", "worker.pid");
  const wscript = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "wscript.exe");
  const env = { ...process.env, PET_DISPATCHER_SUPERVISOR_POLL_MS: "500", PET_DISPATCHER_SUPERVISOR_LOGON_DELAY_MS: "6000",
    PET_DISPATCHER_SUPERVISOR_LOGON_CALM_MS: "1000", PET_DISPATCHER_SUPERVISOR_CALM_SAMPLE_MS: "500", FIXTURE_NODE: process.execPath };
  const spawned: number[] = [];
  const workers = new Set<number>();
  const readWorker = async (): Promise<number | undefined> => {
    try {
      const pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
      return pid > 0 && alive(pid) ? pid : undefined;
    } catch { return undefined; }
  };
  try {
    await mkdir(bin, { recursive: true });
    await writeFile(supervisorPath, await readFile(new URL("../scripts/pet-dispatcher-supervise.js", import.meta.url)));
    await writeFile(join(bin, "pet-dispatcher-start-worker.ps1"), [
      "param([string]$Root)",
      "New-Item -ItemType Directory -Path (Join-Path $Root 'state') -Force | Out-Null",
      "$entry = Join-Path $Root 'app\\releases\\fixture\\index.js'",
      "$p = Start-Process -FilePath $env:FIXTURE_NODE -ArgumentList @('-e', '\"setTimeout(function(){},120000)\"', $entry, 'remote') -WindowStyle Hidden -PassThru",
      "Set-Content -LiteralPath (Join-Path $Root 'state\\worker.pid') -Value $p.Id -Encoding ascii -NoNewline",
      "",
    ].join("\r\n"));
    const startedAt = Date.now();
    const supervisor = spawn(wscript, ["//B", "//Nologo", supervisorPath, "/logon"], { env, windowsHide: true, stdio: "ignore" });
    spawned.push(supervisor.pid ?? 0);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(await readWorker(), undefined, "no worker may start during the logon delay");
    const worker = await waitFor(readWorker, 25_000);
    workers.add(worker);
    assert.ok(Date.now() - startedAt >= 5500, `worker came up after ${Date.now() - startedAt} ms, before the logon delay ended`);
  } finally {
    for (const pid of spawned) if (pid) await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined);
    for (const pid of workers) if (alive(pid)) { try { process.kill(pid); } catch { /* already gone */ } }
    await rm(base, { recursive: true, force: true });
  }
});

test("local installer can run npm build on Windows", { skip: process.platform !== "win32" }, async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-local-npm-"));
  const source = join(base, "source");
  try {
    await mkdir(join(source, "scripts"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "pet-fixture", version: "1.0.0",
      scripts: { build: "node -e \"const fs=require('node:fs');fs.mkdirSync('dist/src',{recursive:true});fs.writeFileSync('dist/src/index.js','fixture')\"" },
    }));
    await writeEnvironmentPolicyFixture(source);
    await writeFile(join(source, "dispatcher.config.example.json"), JSON.stringify({
      workspaceRoot: join(base, "dc", "workspace"), repositories: {}, workspaces: {}, toolRoots: [], networkProfiles: {},
    }));
    for (const name of ["pet-dispatcher-start-worker.ps1", "pet-dispatcher-supervise.js", "pet-dispatcher-secrets.ps1", "pet-dispatcher-restart.ps1", "pet-dispatcher-wakeguard.ps1", "windows-job-guard.ps1"]) {
      await writeFile(join(source, "scripts", name), "# fixture\n");
    }
    await execFileAsync("git", ["init", source]);
    await execFileAsync("git", ["-C", source, "add", "."]);
    await execFileAsync("git", ["-C", source, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "fixture"]);

    const result = await installLocalRuntime({
      sourceRoot: source, installRoot: join(base, "install"), dcRoot: join(base, "dc"),
      workspaceRoot: join(base, "dc", "workspace"), repoUrl: source,
      installDependencies: false, registerStartup: false,
    });
    assert.ok((await stat(join(result.releaseRoot, "dist", "src", "index.js"))).isFile());
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
