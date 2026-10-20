// Workers Builds deploy guard shared by gh-apps Worker deploy scripts.
// Ordering: a build deploys only while its commit is the newest `main` commit
// touching the app's watch paths (git, checked before upload and right before
// activation), so a stale concurrent build never activates.
// Flow: upload version -> recheck head + no foreign activation -> activate ->
// verify live -> apply triggers; on failure roll back by our version id only.
// First deploy and Durable Object lifecycle changes (rejected by
// `versions upload`) use plain `wrangler deploy`, which cannot be rolled back.
// Everything runs under the shared D1 deploy lock (deploy-lock.mjs), renewed
// before each mutation, so builds and credential sync never interleave.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

import { d1Lock } from './deploy-lock.mjs';

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

function gitAtTop() {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  return (args) => execFileSync('git', ['-C', top, ...args], { encoding: 'utf8' }).trim();
}

// Newest commit on origin/main touching `paths` (repo-root pathspecs, incl.
// excludes). Builds run from the app directory, so git runs at the top level.
function realLatestCommit(paths) {
  const git = gitAtTop();
  git(['fetch', '--quiet', '--depth=200', 'origin', 'main']);
  // --first-parent: a merge commit is the main commit for its changes, not its side parent.
  const head = git(['log', '-1', '--first-parent', '--format=%H', 'FETCH_HEAD', '--', ...paths]);
  // A shallow boundary looks parentless, so "touches paths" is unproven there.
  const boundary = git(['rev-parse', '--git-path', 'shallow']);
  let shallow = '';
  try {
    shallow = readFileSync(boundary, 'utf8');
  } catch {
    // not shallow
  }
  if (head && shallow.split('\n').includes(head)) throw new Error('watch-path history deeper than fetched main');
  return head;
}

function realIsAncestor(ancestor, descendant) {
  try {
    gitAtTop()(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

// Predecessor's wrangler config (from its build commit) written next to ours, for
// restoring its routes/domains/crons on rollback. Returns the path or null.
function realPreviousConfig(prevSha, file = 'wrangler.jsonc') {
  try {
    const rel = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
    const body = gitAtTop()(['show', `${prevSha}:${rel}${file}`]);
    const path = `.wrangler-previous.${file}`;
    writeFileSync(path, body);
    return path;
  } catch {
    return null;
  }
}

function json(wrangler, args) {
  const out = wrangler([...args, '--json'], true);
  return JSON.parse(out.slice(out.search(/[[{]/)));
}

const errorText = (error) => `${error?.stdout ?? ''}${error?.stderr ?? ''}${error?.message ?? ''}`;

// Active deployment: specs, primary version id, build sha from its message, source sha.
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
  // Source commit for config restore: build mark, else a SHA tag (credential sync keeps the live tag).
  const tag = String(version.annotations?.['workers/tag'] ?? '').toLowerCase();
  const source = build ?? (/^[0-9a-f]{40}$/.test(tag) ? tag : null);
  return { specs: versions.map((v) => `${v.version_id}@${v.percentage}%`), versionId: primary.version_id, build, source };
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
export async function guardedDeploy(options, deps = {}) {
  const { name, sha } = options;
  const lock = deps.lock ?? d1Lock();
  const owner = `build:${sha.slice(0, 12)}:${randomUUID()}`;
  if (!(await lock.acquire(name, owner))) {
    console.error(`${name}: deploy lock busy for too long; not deploying ${sha}.`);
    return 1;
  }
  // Renewed before every mutation; losing it (lease expired, taken over) aborts.
  const holdLock = () => {
    if (!lock.renew(name, owner)) throw new Error(`${name}: lost deploy lock before a mutation`);
  };
  try {
    return await deployLocked(options, deps, holdLock);
  } finally {
    try {
      lock.release(name, owner);
    } catch (error) {
      console.warn(`${name}: deploy lock release failed (lease expires): ${error.message}`);
    }
  }
}

async function deployLocked(
  { name, sha, paths, deployArgs = [], verify },
  {
    wrangler = realWrangler,
    latestCommit = realLatestCommit,
    isAncestor = realIsAncestor,
    previousConfig = realPreviousConfig,
  },
  holdLock,
) {
  const message = `build=${sha}`;
  const stale = () => {
    const head = latestCommit(paths);
    if (!/^[0-9a-f]{40}$/.test(head)) throw new Error(`${name}: no main commit matches watch paths ${paths.join(' ')}`);
    // head reachable from sha: one push of several commits; sha's tree already has head's changes.
    if (head === sha || isAncestor(head, sha)) return false;
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
    holdLock();
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
  holdLock();
  wrangler(['versions', 'deploy', `${versionId}@100%`, '--name', name, '--message', message, '--yes']);

  // versions upload/deploy never touch routes, domains or crons.
  let triggersApplied = false;
  const triggers = () => {
    // Applied while our version still owns the Worker; a replacement build applies its own.
    if (active(wrangler, name)?.versionId !== versionId) return true;
    try {
      holdLock();
      triggersApplied = true;
      wrangler(['triggers', 'deploy', '--name', name]);
      return true;
    } catch {
      console.error(`${name}: triggers deploy failed.`);
      return false;
    }
  };
  // Triggers first so verify probes the final routes/domains.
  if (triggers() && (await verify())) {
    console.log(`${name}: deployment ${sha} verified.`);
    return 0;
  }
  const now = active(wrangler, name);
  if (now?.versionId !== versionId) {
    console.error(`${name}: ${sha} unverified and no longer active; leaving the newer deployment in place.`);
    return 1;
  }
  console.error(`${name}: ${sha} failed verification or triggers; restoring ${previous.specs.join(' ')}.`);
  holdLock();
  wrangler([
    'versions', 'deploy', ...previous.specs,
    '--name', name,
    '--message', `Rollback failed deployment ${sha.slice(0, 12)}`,
    '--yes',
  ]);
  if (triggersApplied) {
    // Version rollback leaves triggers alone; re-apply the predecessor's.
    const config = previous.source ? previousConfig(previous.source) : null;
    if (!config) {
      console.error(`${name}: could not restore predecessor triggers; check routes/crons manually.`);
      return 1;
    }
    try {
      wrangler(['triggers', 'deploy', '--name', name, '--config', config]);
    } catch {
      console.error(`${name}: restoring predecessor triggers failed; check routes/crons manually.`);
    } finally {
      rmSync(config, { force: true });
    }
  }
  return 1;
}
