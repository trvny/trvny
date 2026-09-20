import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { installLocalRuntime } from "../scripts/install-local-runtime.js";
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
  const launcher = await readFile(new URL("../scripts/pet-dispatcher-launch.ps1", import.meta.url), "utf8");
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
    await writeFile(join(source, "scripts", "pet-dispatcher-launch.ps1"), "# launcher fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-launch-hidden.js"), "// shim fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-secrets.ps1"), "# secrets fixture\n");
    await writeFile(join(source, "scripts", "pet-dispatcher-restart.ps1"), "# restart fixture\n");
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
    assert.equal(await readFile(join(result.paths.binRoot, "pet-dispatcher-launch.ps1"), "utf8"), "# launcher fixture\n");
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
    for (const name of ["pet-dispatcher-launch.ps1", "pet-dispatcher-launch-hidden.js", "pet-dispatcher-secrets.ps1", "pet-dispatcher-restart.ps1", "windows-job-guard.ps1"]) await writeFile(join(source, "scripts", name), "# fixture\n");
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

test("startup command uses native Windows quoting", async () => {
  const module = await import("../scripts/install-local-runtime.js");
  assert.equal(module.windowsStartupCommand(String.raw`C:\Program Files\Windows\wscript.exe`, String.raw`C:\Users\travn\.local\share\pet-dispatcher\bin\pet-dispatcher-launch-hidden.js`),
    '"C:\\Program Files\\Windows\\wscript.exe" //B //Nologo "C:\\Users\\travn\\.local\\share\\pet-dispatcher\\bin\\pet-dispatcher-launch-hidden.js"');
});

test("hidden launch shim starts the launcher with SW_HIDE", async () => {
  const shim = await readFile(new URL("../scripts/pet-dispatcher-launch-hidden.js", import.meta.url), "utf8");
  assert.match(shim, /pet-dispatcher-launch\.ps1/u);
  assert.match(shim, /-WindowStyle Hidden/u);
  assert.match(shim, /, 0, false\)/u);
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
    for (const name of ["pet-dispatcher-launch.ps1", "pet-dispatcher-launch-hidden.js", "pet-dispatcher-secrets.ps1", "pet-dispatcher-restart.ps1", "windows-job-guard.ps1"]) {
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
