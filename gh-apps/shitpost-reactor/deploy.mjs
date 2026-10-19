// Workers Builds deploy command (`npm run deploy`): stamp commit, deploy,
// verify live /version + /archive, roll back to the previous deployment on failure.
import { execFileSync } from 'node:child_process';

const ORIGIN = 'https://shitpost.trfny.com';
const ATTEMPTS = 12;
const DELAY_MS = 5_000;

const sha = process.env.WORKERS_CI_COMMIT_SHA ?? '';
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error('WORKERS_CI_COMMIT_SHA must be a 40-char commit SHA; refusing to deploy.');
  process.exit(1);
}

const wrangler = (...args) =>
  execFileSync('npx', ['--no-install', 'wrangler', ...args], { stdio: 'inherit' });

async function text(path) {
  try {
    const response = await fetch(`${ORIGIN}${path}${path.includes('?') ? '&' : '?'}deploy-check=${sha}`, {
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function healthy() {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if ((await text('/version'))?.trim() === sha && (await text('/archive'))?.includes('Newest first')) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  return false;
}

wrangler('deploy', '--var', `DEPLOY_COMMIT:${sha}`);
if (!(await healthy())) {
  console.error(`Deployment ${sha} did not serve /version and /archive; rolling back.`);
  wrangler('rollback', '--message', `Rollback failed Shitpost Reactor deployment ${sha.slice(0, 12)}`, '--yes');
  process.exit(1);
}
console.log(`Deployment ${sha} verified.`);
