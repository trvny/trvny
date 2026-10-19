// Workers Builds deploy guard shared by gh-apps Worker deploy scripts.
// Ordering: a build deploys only while its commit is the newest `main` commit
// touching the app's watch paths (git, checked before upload and right before
// activation), so a stale concurrent build never activates.
// Flow: upload version -> recheck head + no foreign activation -> activate ->
// verify live -> apply triggers; on failure roll back by our version id only.
// First deploy and Durable Object lifecycle changes (rejected by
// `versions upload`) use plain `wrangler deploy`, which cannot be rolled back.
import { execFileSync } from 'node:child_process';

const BUILD_MARK_RE = /^build=([0-9a-f]{40})/;
const VERSION_RE = /Worker Version ID:\s*([0-9a-f-]{36})/i;
const LIFECYCLE_RE = /durable object|migration|10211|lifecycle/i;

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

// Newest commit on origin/main touching `paths` (git pathspecs, incl. excludes).
function realLatestCommit(paths) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  git(['fetch', '--quiet', '--depth=200', 'origin', 'main']);
  return git(['log', '-1', '--format=%H', 'FETCH_HEAD', '--', ...paths]);
}

function json(wrangler, args) {
  const out = wrangler([...args, '--json'], true);
  return JSON.parse(out.slice(out.search(/[[{]/)));
}

const errorText = (error) => `${error?.stdout ?? ''}${error?.stderr ?? ''}${error?.message ?? ''}`;

// Active deployment: specs, primary version id, build sha from its message.
// null only when the Worker has no deployment yet; other failures throw.
function active(wrangler, name) {
  let deployment;
  try {
    deployment = json(wrangler, ['deployments', 'status', '--name', name]);
  } catch (error) {
    if (/has no deployments/i.test(errorText(error))) return null;
    throw error;
  }
  const versions = deployment.versions ?? [];
  if (!versions.length) return null;
  const primary = [...versions].sort((a, b) => b.percentage - a.percentage)[0];
  const version = json(wrangler, ['versions', 'view', primary.version_id, '--name', name]);
  const build = String(version.annotations?.['workers/message'] ?? '').match(BUILD_MARK_RE)?.[1] ?? null;
  return { specs: versions.map((v) => `${v.version_id}@${v.percentage}%`), versionId: primary.version_id, build };
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

// Returns the process exit code. `deps` is injectable for tests.
// `paths`: git pathspecs mirroring the Workers Builds watch paths.
export async function guardedDeploy(
  { name, sha, paths, deployArgs = [], verify },
  { wrangler = realWrangler, latestCommit = realLatestCommit } = {},
) {
  const message = `build=${sha}`;
  const stale = () => {
    const head = latestCommit(paths);
    if (head === sha) return false;
    console.log(`${name}: ${sha} superseded by ${head} on main; skipping (its build deploys).`);
    return true;
  };
  if (stale()) return 0;

  const previous = active(wrangler, name);
  let versionId = null;
  if (previous) {
    try {
      versionId = wrangler(['versions', 'upload', ...deployArgs, '--message', message], true).match(VERSION_RE)?.[1] ?? null;
    } catch (error) {
      if (!LIFECYCLE_RE.test(errorText(error))) throw error;
      console.warn(`${name}: versions upload rejected for a Durable Object lifecycle change; using wrangler deploy.`);
    }
  }
  if (!versionId) {
    if (previous && stale()) return 0;
    wrangler(['deploy', ...deployArgs, '--message', message]);
    if (await verify()) return 0;
    console.error(`${name}: ${sha} failed live verification; no safe rollback for this deploy path.`);
    return 1;
  }

  // Fences right before activation.
  if (stale()) return 0;
  const current = active(wrangler, name);
  if (current && current.versionId !== previous.versionId && !current.build) {
    // Non-build activation meanwhile (e.g. credential sync): our upload may predate it.
    console.error(`${name}: concurrent non-build deployment ${current.versionId}; not activating ${sha}. Re-run the build.`);
    return 1;
  }
  wrangler(['versions', 'deploy', `${versionId}@100%`, '--name', name, '--message', message, '--yes']);

  if (await verify()) {
    // versions upload/deploy never touch routes, domains or crons.
    wrangler(['triggers', 'deploy', '--name', name]);
    console.log(`${name}: deployment ${sha} verified.`);
    return 0;
  }
  const now = active(wrangler, name);
  if (now?.versionId !== versionId) {
    console.error(`${name}: ${sha} unverified and no longer active; leaving the newer deployment in place.`);
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
