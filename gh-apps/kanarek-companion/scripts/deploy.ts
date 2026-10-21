import { spawnSync } from 'node:child_process';

import { guardedDeploy, poll } from '../../core/worker-deploy.mjs';

const HEALTH_URL = 'https://automation.travny.workers.dev/health';
const commitSha = process.env.WORKERS_CI_COMMIT_SHA?.trim().toLowerCase();
const workersCi = process.env.WORKERS_CI === '1';
const validSha = Boolean(commitSha && /^[0-9a-f]{40}$/.test(commitSha));

if (workersCi && !validSha) {
  throw new Error('Workers Builds is missing a valid WORKERS_CI_COMMIT_SHA');
}

// Local/manual deploy: plain wrangler deploy, no guard.
if (!workersCi) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['wrangler', 'deploy', ...(validSha ? ['--tag', commitSha as string] : [])];
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Rollback reverts Worker code only, not Durable Object migrations.
const sha = commitSha as string;
process.exit(
  await guardedDeploy({
    name: 'automation',
    sha,
    // Mirrors the Workers Builds watch paths.
    paths: [
      'gh-apps/kanarek-companion',
      'gh-apps/core',
      ':(exclude,glob)gh-apps/kanarek-companion/**/*.md',
      ':(exclude,glob)gh-apps/core/**/*.md',
    ],
    deployArgs: ['--tag', sha],
    verify: () =>
      poll(async () => {
        const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return false;
        const health = (await response.json()) as {
          ok?: boolean;
          reviewWebhook?: { ready?: boolean };
          gateway?: { workerVersion?: { tag?: string } };
        };
        return health.ok === true && health.reviewWebhook?.ready === true && health.gateway?.workerVersion?.tag === sha;
      }),
  }),
);
