// Workers Builds deploy command (`npm run deploy`): stamp commit, deploy,
// verify live /version + /archive. On failure roll back to the captured
// predecessor, but only while this build's version is still the active one
// (a concurrent newer build owns the Worker otherwise).
import { execFileSync } from 'node:child_process';

const NAME = 'shitpost-reactor';
const ORIGIN = 'https://shitpost.trfny.com';
const ATTEMPTS = 12;
const DELAY_MS = 5_000;

const sha = process.env.WORKERS_CI_COMMIT_SHA ?? '';
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error('WORKERS_CI_COMMIT_SHA must be a 40-char commit SHA; refusing to deploy.');
  process.exit(1);
}

const wrangler = (args, capture = false) =>
  execFileSync('npx', ['--no-install', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

// Active deployment as ["<version_id>@<percentage>%", ...].
function activeSpecs() {
  const out = wrangler(['deployments', 'status', '--name', NAME, '--json'], true);
  const status = JSON.parse(out.slice(out.indexOf('{')));
  const specs = (status.versions ?? []).map((v) => `${v.version_id}@${v.percentage}%`);
  if (!specs.length) throw new Error('no active deployment');
  return specs;
}

async function text(path) {
  try {
    const response = await fetch(`${ORIGIN}${path}?deploy-check=${sha}`, {
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

const previous = activeSpecs();
wrangler(['deploy', '--var', `DEPLOY_COMMIT:${sha}`]);
const ours = activeSpecs().join(' ');

if (await healthy()) {
  console.log(`Deployment ${sha} verified.`);
  process.exit(0);
}
if (activeSpecs().join(' ') !== ours) {
  console.error(`Deployment ${sha} unverified and no longer active; leaving newer deployment in place.`);
  process.exit(1);
}
console.error(`Deployment ${sha} did not serve /version and /archive; restoring ${previous.join(' ')}.`);
wrangler([
  'versions', 'deploy', ...previous,
  '--name', NAME,
  '--message', `Rollback failed Shitpost Reactor deployment ${sha.slice(0, 12)}`,
  '--yes',
]);
process.exit(1);
