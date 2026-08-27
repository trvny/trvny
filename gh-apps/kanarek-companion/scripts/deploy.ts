import { spawnSync } from 'node:child_process';

const commitSha = process.env.WORKERS_CI_COMMIT_SHA?.trim();
const workersCi = process.env.WORKERS_CI === '1';

if (workersCi && (!commitSha || !/^[0-9a-f]{40}$/i.test(commitSha))) {
  throw new Error('Workers Builds is missing a valid WORKERS_CI_COMMIT_SHA');
}

const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['wrangler', 'deploy'];
if (commitSha && /^[0-9a-f]{40}$/i.test(commitSha)) {
  args.push('--tag', commitSha.toLowerCase());
}

const result = spawnSync(executable, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
