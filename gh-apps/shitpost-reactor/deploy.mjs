// Workers Builds deploy command (`npm run deploy`): guarded deploy (stale check,
// live /version + /archive probe, safe rollback) via ../core/worker-deploy.mjs.
import { guardedDeploy, poll } from '../core/worker-deploy.mjs';

const ORIGIN = 'https://shitpost.trfny.com';
const sha = process.env.WORKERS_CI_COMMIT_SHA ?? '';
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error('WORKERS_CI_COMMIT_SHA must be a 40-char commit SHA; refusing to deploy.');
  process.exit(1);
}

async function text(path) {
  const response = await fetch(`${ORIGIN}${path}?deploy-check=${sha}`, { signal: AbortSignal.timeout(15_000) });
  return response.ok ? await response.text() : null;
}

process.exit(
  await guardedDeploy({
    name: 'shitpost-reactor',
    sha,
    deployArgs: ['--var', `DEPLOY_COMMIT:${sha}`],
    verify: () =>
      poll(async () => (await text('/version'))?.trim() === sha && Boolean((await text('/archive'))?.includes('Newest first'))),
  }),
);
