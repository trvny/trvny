// Workers Builds deploy guard shared by gh-apps Worker deploy scripts.
// - stale: skip when the active version comes from a newer commit (concurrent builds);
// - verify: run the app's live probe for this commit;
// - rollback: restore the captured predecessor, only while our version is still active.
// Version message carries `commit=<sha> ts=<committer unix time>` for the stale check.
import { execFileSync } from 'node:child_process';

const MARK_RE = /commit=([0-9a-f]{40}) ts=(\d+)/;

function wrangler(args, capture = false) {
  return execFileSync('npx', ['--no-install', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function json(args) {
  const out = wrangler([...args, '--json'], true);
  return JSON.parse(out.slice(out.search(/[[{]/)));
}

function commitTime(sha) {
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct', sha], { encoding: 'utf8' }).trim()) || null;
  } catch {
    return null;
  }
}

// Active deployment: version specs + the commit mark of its primary version.
function active(name) {
  const deployment = json(['deployments', 'status', '--name', name]);
  const versions = deployment.versions ?? [];
  if (!versions.length) throw new Error(`${name}: no active deployment`);
  const primary = [...versions].sort((a, b) => b.percentage - a.percentage)[0];
  let mark = null;
  try {
    const version = json(['versions', 'view', primary.version_id, '--name', name]);
    const match = String(version.annotations?.['workers/message'] ?? '').match(MARK_RE);
    if (match) mark = { sha: match[1], ts: Number(match[2]) };
  } catch {
    // unreadable metadata -> no stale guard
  }
  return { specs: versions.map((v) => `${v.version_id}@${v.percentage}%`), mark };
}

export async function poll(check, attempts = 12, delayMs = 5_000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await check()) return true;
    } catch {
      // probe error = not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

// Returns the process exit code.
export async function guardedDeploy({ name, sha, deployArgs = [], verify }) {
  const ts = commitTime(sha);
  let previous = null;
  try {
    previous = active(name);
  } catch (error) {
    // first deploy (or unreadable status): nothing to guard against or restore
    console.warn(`${name}: no readable active deployment (${error.message}); deploying without rollback.`);
  }
  if (ts && previous?.mark && previous.mark.sha !== sha && previous.mark.ts > ts) {
    console.log(`${name}: ${sha} superseded by active ${previous.mark.sha}; skipping deploy.`);
    return 0;
  }
  const message = ts ? `commit=${sha} ts=${ts}` : `commit=${sha}`;
  wrangler(['deploy', ...deployArgs, '--message', message]);
  const ours = active(name).specs.join(' ');

  if (await verify()) {
    console.log(`${name}: deployment ${sha} verified.`);
    return 0;
  }
  if (!previous) {
    console.error(`${name}: ${sha} failed live verification; no predecessor to restore.`);
    return 1;
  }
  if (active(name).specs.join(' ') !== ours) {
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
