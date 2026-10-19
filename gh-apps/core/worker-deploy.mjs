// Workers Builds deploy guard shared by gh-apps Worker deploy scripts.
// Upload a version, recheck freshness right before activating it, verify live,
// roll back by version id, and let the newest build reclaim the Worker if an
// older concurrent build activated after it. Version message carries
// `commit=<sha> ts=<committer unix time>`.
// Falls back to plain `wrangler deploy` (no rollback) for the first deploy and
// for Durable Object lifecycle changes, which `versions upload` rejects.
import { execFileSync } from 'node:child_process';

const MARK_RE = /commit=([0-9a-f]{40}) ts=(\d+)/;
const VERSION_RE = /Worker Version ID:\s*([0-9a-f-]{36})/i;
const SETTLE_MS = 10_000;

function realWrangler(args, capture = false) {
  if (!capture) return execFileSync('npx', ['--no-install', 'wrangler', ...args], { stdio: 'inherit' });
  try {
    const out = execFileSync('npx', ['--no-install', 'wrangler', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!args.includes('--json')) process.stdout.write(out);
    return out;
  } catch (error) {
    process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`);
    throw error;
  }
}

function json(wrangler, args) {
  const out = wrangler([...args, '--json'], true);
  return JSON.parse(out.slice(out.search(/[[{]/)));
}

function realCommitTime(sha) {
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct', sha], { encoding: 'utf8' }).trim()) || null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Active deployment: specs, primary version id, and its commit mark.
// null only when the Worker has no deployment yet; other failures throw.
function active(wrangler, name) {
  let deployment;
  try {
    deployment = json(wrangler, ['deployments', 'status', '--name', name]);
  } catch (error) {
    if (/has no deployments/i.test(`${error.stdout ?? ''}${error.stderr ?? ''}${error.message}`)) return null;
    throw error;
  }
  const versions = deployment.versions ?? [];
  if (!versions.length) return null;
  const primary = [...versions].sort((a, b) => b.percentage - a.percentage)[0];
  const version = json(wrangler, ['versions', 'view', primary.version_id, '--name', name]);
  const match = String(version.annotations?.['workers/message'] ?? '').match(MARK_RE);
  return {
    specs: versions.map((v) => `${v.version_id}@${v.percentage}%`),
    versionId: primary.version_id,
    mark: match ? { sha: match[1], ts: Number(match[2]) } : null,
  };
}

const newer = (state, sha, ts) => Boolean(ts && state?.mark && state.mark.sha !== sha && state.mark.ts > ts);

export async function poll(check, attempts = 12, delayMs = 5_000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await check()) return true;
    } catch {
      // probe error = not ready yet
    }
    await sleep(delayMs);
  }
  return false;
}

// Returns the process exit code. `deps` is injectable for tests.
export async function guardedDeploy(
  { name, sha, deployArgs = [], verify },
  { wrangler = realWrangler, commitTime = realCommitTime, wait = sleep } = {},
) {
  const ts = commitTime(sha);
  const message = ts ? `commit=${sha} ts=${ts}` : `commit=${sha}`;
  const previous = active(wrangler, name);
  if (newer(previous, sha, ts)) {
    console.log(`${name}: ${sha} superseded by active ${previous.mark.sha}; skipping deploy.`);
    return 0;
  }

  let versionId = null;
  if (previous) {
    try {
      versionId = wrangler(['versions', 'upload', ...deployArgs, '--message', message], true).match(VERSION_RE)?.[1] ?? null;
    } catch {
      console.warn(`${name}: versions upload rejected (Durable Object lifecycle change?); using wrangler deploy.`);
    }
  }
  if (!versionId) {
    // First deploy or DO lifecycle change: atomic, cannot be rolled back across.
    wrangler(['deploy', ...deployArgs, '--message', message]);
    if (await verify()) return 0;
    console.error(`${name}: ${sha} failed live verification; no safe rollback for this deploy path.`);
    return 1;
  }

  // Freshness recheck right before activation.
  const current = active(wrangler, name);
  if (newer(current, sha, ts)) {
    console.log(`${name}: ${sha} superseded by active ${current.mark.sha} before activation; skipping.`);
    return 0;
  }
  const activate = () =>
    wrangler(['versions', 'deploy', `${versionId}@100%`, '--name', name, '--message', message, '--yes']);
  activate();

  if (await verify()) {
    // An older build that passed its recheck just before we activated may land after us.
    await wait(SETTLE_MS);
    const after = active(wrangler, name);
    if (after && after.versionId !== versionId && after.mark && ts && after.mark.ts < ts) {
      console.warn(`${name}: older ${after.mark.sha} activated after ${sha}; reclaiming.`);
      activate();
    }
    console.log(`${name}: deployment ${sha} verified.`);
    return 0;
  }
  const now = active(wrangler, name);
  if (now?.versionId !== versionId) {
    console.error(`${name}: ${sha} unverified and no longer active; leaving newer deployment in place.`);
    return 1;
  }
  console.error(`${name}: ${sha} failed live verification; restoring ${previous.specs.join(' ')}.`);
  wrangler([
    'versions', 'deploy', ...previous.specs,
    '--name', name,
    '--message', `Rollback failed deployment ${sha.slice(0, 12)}`,
    '--yes',
  ]);
  return 1;
}
