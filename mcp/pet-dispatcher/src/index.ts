#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HostGit } from "./host-git.js";
import { SessionManager } from "./sessions.js";
import { CommandRunner } from "./sandbox.js";
import { createServer } from "./server.js";
import { ConfinedRemoteExecutor } from "./remote-executor.js";
import { CloudflareQueueTransport, RemoteJournal, RemoteWorker } from "./remote-transport.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  const git = new HostGit(sessions, config);

  if (process.argv[2] === "doctor") {
    console.log(JSON.stringify({
      sandbox: runner.securityStatus(),
      repositories: Object.keys(config.repositories).sort(),
      providers: {
        openrouter: Boolean(process.env.OPENROUTER_API_KEY),
        gemini: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
      },
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
    return;
  }

  if (process.argv[2] === "remote") {
    if (!config.remote?.enabled) throw new Error("remote worker is not enabled in dispatcher config");
    const transport = new CloudflareQueueTransport(config.remote);
    const journal = new RemoteJournal(config.remote.journalPath);
    const executor = new ConfinedRemoteExecutor(config, sessions, runner);
    const worker = new RemoteWorker(transport, journal, executor);
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
    console.error(`pet-dispatcher remote worker polling for ${config.remote.deviceId}`);
    await worker.run(controller.signal);
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
