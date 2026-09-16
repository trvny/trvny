#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HostGit } from "./host-git.js";
import { SessionManager } from "./sessions.js";
import { CommandRunner } from "./sandbox.js";
import { createServer } from "./server.js";
import { ConfinedRemoteExecutor } from "./remote-executor.js";
import { CloudflareQueueTransport, RemoteJournal, RemoteWorker } from "./remote-transport.js";
import { acquireRemoteWorkerLease } from "./remote-worker-lease.js";
import { probeRouting } from "./agent-router.js";
import { AGENT_PROVIDER_ENV_NAMES } from "./providers.js";
import { deviceMetaSchema } from "./device-meta.js";
import { REMOTE_DIRECT_TOOLS } from "./remote-protocol.js";

async function main(): Promise<void> {
  if (process.argv[2] === "provider-env-names") {
    console.log(JSON.stringify(AGENT_PROVIDER_ENV_NAMES));
    return;
  }
  const config = await loadConfig();
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  const git = new HostGit(sessions, config);

  if (process.argv[2] === "doctor") {
    const routing = await probeRouting();
    const backends = new Map(routing.backends.map((backend) => [backend.id, backend.availability]));
    console.log(JSON.stringify({
      sandbox: runner.securityStatus(),
      repositories: Object.keys(config.repositories).sort(),
      providers: {
        openrouter: backends.get("openrouter") === "available",
        gemini: backends.get("gemini") === "available",
      },
      routing,
      networkProfiles: Object.keys(config.networkProfiles).sort(),
      git: await git.probe(),
      remote: config.remote ? {
        enabled: config.remote.enabled,
        deviceId: config.remote.deviceId,
        queueToken: Boolean(process.env[config.remote.queueTokenEnv]),
        signingSecret: Boolean(process.env[config.remote.signingSecretEnv]),
      } : { enabled: false },
      activeSessions: sessions.list().length,
    }, null, 2));
    await runner.close();
    sessions.dispose();
    return;
  }

  if (process.argv[2] === "remote") {
    if (!config.remote?.enabled) throw new Error("remote worker is not enabled in dispatcher config");
    const lease = await acquireRemoteWorkerLease(`${config.remote.deviceId}:${config.remote.queueId}`);
    try {
      const transport = new CloudflareQueueTransport(config.remote);
      const journal = new RemoteJournal(config.remote.journalPath);
      const executor = new ConfinedRemoteExecutor(config, sessions, runner);
      const metaProvider = () => {
        const sandbox = runner.securityStatus() as { supported?: boolean; processGuard?: string; networkDefault?: string; isolationTier?: string | null };
        return deviceMetaSchema.parse({
          deviceId: config.remote?.deviceId ?? "unknown", transport: "cloudflare-queues-http-pull", protocol: 1,
          updatedAt: new Date().toISOString(), repositories: Object.keys(config.repositories).sort(),
          workspaces: Object.keys(config.workspaces ?? {}).sort(), directTools: [...REMOTE_DIRECT_TOOLS], localTools: [],
          activeSessions: sessions.activeCount(), activeProcesses: runner.activeProcessCount(),
          sandbox: { supported: sandbox.supported === true, processGuard: sandbox.processGuard ?? "unknown",
            networkDefault: sandbox.networkDefault ?? "deny", isolationTier: sandbox.isolationTier ?? null },
        });
      };
      const worker = new RemoteWorker(transport, journal, executor, metaProvider);
      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      process.once("SIGTERM", () => controller.abort());
      console.error(`pet-dispatcher remote worker polling for ${config.remote.deviceId}`);
      await worker.run(controller.signal);
    } finally {
      await runner.close().catch(() => undefined);
      sessions.dispose();
      await lease.close().catch(() => undefined);
    }
    return;
  }

  const server = createServer(config, sessions, runner);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("pet-dispatcher MCP running on stdio");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
