// Shared deploy lock (D1 `deploy-locks`, table `locks`) serializing every path
// that changes a Worker's active deployment: Workers Builds deploy scripts and
// the Actions credential sync. One row per Worker; lease expires so a crashed
// holder cannot block forever. Acquire is a single atomic upsert.
// CLI (Actions): node deploy-lock.mjs acquire|release <worker> <owner>
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LOCK_DB = 'deploy-locks';
const TTL_S = 15 * 60;
const WAIT_MS = 20 * 60_000;
const RETRY_MS = 10_000;
const SAFE = /^[A-Za-z0-9:._-]{1,200}$/;

function realWrangler(args) {
  return execFileSync('npx', ['--no-install', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function check(value, what) {
  if (!SAFE.test(value)) throw new Error(`invalid lock ${what}: ${value}`);
  return value;
}

export function d1Lock({
  wrangler = realWrangler,
  now = () => Math.floor(Date.now() / 1000),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitMs = WAIT_MS,
  retryMs = RETRY_MS,
} = {}) {
  const sql = (command) => {
    const out = wrangler(['d1', 'execute', LOCK_DB, '--remote', '--json', '--yes', '--command', command]);
    const results = JSON.parse(out.slice(out.indexOf('[')));
    return results.flatMap((r) => r.results ?? []);
  };
  // Takes the lease if free, expired, or already ours (renewal). True when held.
  const tryAcquire = (name, owner) => {
    const t = now();
    const rows = sql(
      `INSERT INTO locks (name, owner, expires_at) VALUES ('${check(name, 'name')}', '${check(owner, 'owner')}', ${t + TTL_S}) ` +
        `ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at ` +
        `WHERE locks.expires_at < ${t} OR locks.owner = excluded.owner RETURNING owner`,
    );
    return rows.some((row) => row.owner === owner);
  };
  return {
    async acquire(name, owner) {
      for (let waited = 0; ; waited += retryMs) {
        if (tryAcquire(name, owner)) return true;
        if (waited >= waitMs) return false;
        console.log(`deploy lock ${name} busy; waiting.`);
        await wait(retryMs);
      }
    },
    renew: tryAcquire,
    release(name, owner) {
      sql(`DELETE FROM locks WHERE name = '${check(name, 'name')}' AND owner = '${check(owner, 'owner')}'`);
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [action, name, owner] = process.argv.slice(2);
  const lock = d1Lock();
  if (action === 'acquire') {
    if (!(await lock.acquire(name, owner))) {
      console.error(`could not acquire deploy lock ${name}`);
      process.exit(1);
    }
  } else if (action === 'release') {
    lock.release(name, owner);
  } else {
    console.error('usage: deploy-lock.mjs acquire|release <worker> <owner>');
    process.exit(2);
  }
}
