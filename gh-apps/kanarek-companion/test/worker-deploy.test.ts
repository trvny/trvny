import assert from 'node:assert/strict';
import test from 'node:test';

import { d1Lock } from '../../core/deploy-lock.mjs';
import { guardedDeploy } from '../../core/worker-deploy.mjs';

// Fake wrangler + git head for gh-apps/core/worker-deploy.mjs.

const OLD = 'a'.repeat(40);
const OURS = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);
const LIVE = '00000000-0000-0000-0000-00000000000a';

type Fake = {
  head: string;
  ancestors: string[];
  active: { version_id: string; percentage: number }[];
  messages: Record<string, string>;
  tags: Record<string, string>;
  calls: string[];
  uploadError?: string;
  triggersFail?: boolean;
  afterUpload?: (fake: Fake) => void;
  afterActivate?: (fake: Fake) => void;
};

function fake(activeBuild: string | null, head = OURS): Fake {
  const state: Fake = { head, ancestors: [], active: [], messages: {}, tags: {}, calls: [] };
  if (activeBuild) {
    state.messages[LIVE] = `build=${activeBuild}`;
    state.active = [{ version_id: LIVE, percentage: 100 }];
  }
  return state;
}

let counter = 0;
function wrangler(state: Fake) {
  return (args: string[]) => {
    const command = args.slice(0, 2).join(' ');
    state.calls.push(command);
    const message = args[args.indexOf('--message') + 1];
    const create = () => {
      const id = `00000000-0000-0000-0000-${String(++counter).padStart(12, '0')}`;
      state.messages[id] = message;
      return id;
    };
    if (command === 'deployments status') {
      if (!state.active.length) throw new Error('The Worker w has no deployments.');
      return JSON.stringify({ versions: state.active });
    }
    if (command === 'versions view') {
      return JSON.stringify({ annotations: { 'workers/message': state.messages[args[2]], 'workers/tag': state.tags[args[2]] } });
    }
    if (command === 'versions upload') {
      if (state.uploadError) throw new Error(state.uploadError);
      const id = create();
      state.afterUpload?.(state);
      return `Worker Version ID: ${id}`;
    }
    if (command === 'versions deploy') {
      state.active = args
        .filter((arg) => /^[0-9a-f-]{36}@/.test(arg))
        .map((spec) => ({ version_id: spec.split('@')[0], percentage: Number.parseInt(spec.split('@')[1], 10) }));
      state.afterActivate?.(state);
      return '';
    }
    if (command === 'triggers deploy') {
      if (args.includes('--config')) {
        state.calls.push(`restore ${args[args.indexOf('--config') + 1]}`);
        return '';
      }
      if (state.triggersFail) throw new Error('route conflict');
      return '';
    }
    if (args[0] === 'deploy') {
      state.active = [{ version_id: create(), percentage: 100 }];
      return '';
    }
    throw new Error(`unexpected wrangler ${args.join(' ')}`);
  };
}

const activeBuild = (state: Fake) => state.messages[state.active[0].version_id]?.match(/build=(\w+)/)?.[1];

type FakeLock = { held: string | null; acquire: boolean; renewals: number; loseAfter?: number; released: string[] };

function fakeLock(state: FakeLock = { held: null, acquire: true, renewals: 0, released: [] }) {
  return {
    state,
    async acquire(_name: string, owner: string) {
      if (!state.acquire) return false;
      state.held = owner;
      return true;
    },
    renew(_name: string, owner: string) {
      state.renewals += 1;
      return state.held === owner && (state.loseAfter === undefined || state.renewals <= state.loseAfter);
    },
    release(_name: string, owner: string) {
      state.released.push(owner);
    },
  };
}

function run(state: Fake, healthy: boolean, runner = wrangler(state), lock = fakeLock()) {
  return guardedDeploy(
    { name: 'w', sha: OURS, paths: ['gh-apps/w'], verify: async () => healthy },
    {
      wrangler: runner,
      latestCommit: () => state.head,
      isAncestor: (a: string, d: string) => state.ancestors.includes(`${a}>${d}`),
      previousConfig: (prev: string) => `prev-${prev.slice(0, 1)}.jsonc`,
      lock,
    },
  );
}

test('newest commit uploads, activates, applies triggers', async () => {
  const state = fake(OLD);
  assert.equal(await run(state, true), 0);
  assert.equal(activeBuild(state), OURS);
  assert.ok(state.calls.includes('versions upload'));
  assert.ok(state.calls.includes('triggers deploy'));
});

test('superseded commit on main skips without touching the Worker', async () => {
  const state = fake(OLD, NEWER);
  assert.equal(await run(state, true), 0);
  assert.equal(activeBuild(state), OLD);
  assert.deepEqual(state.calls, []);
});

test('commit superseded during upload is not activated', async () => {
  const state = fake(OLD);
  state.afterUpload = (s) => {
    s.head = NEWER;
  };
  assert.equal(await run(state, true), 0);
  assert.equal(activeBuild(state), OLD);
});

test('failed verify restores the predecessor while ours is active', async () => {
  const state = fake(OLD);
  assert.equal(await run(state, false), 1);
  assert.equal(activeBuild(state), OLD);
});

test('failed verify never rolls back a version that replaced ours', async () => {
  const state = fake(OLD);
  state.afterActivate = (s) => {
    s.afterActivate = undefined;
    s.messages['00000000-0000-0000-0000-0000000000ff'] = `build=${NEWER}`;
    s.active = [{ version_id: '00000000-0000-0000-0000-0000000000ff', percentage: 100 }];
  };
  assert.equal(await run(state, false), 1);
  assert.equal(activeBuild(state), NEWER);
});

test('concurrent non-build activation (credential sync) blocks activation', async () => {
  const state = fake(OLD);
  state.afterUpload = (s) => {
    s.messages['00000000-0000-0000-0000-0000000000ee'] = 'Kanarek credential sync 1.1';
    s.active = [{ version_id: '00000000-0000-0000-0000-0000000000ee', percentage: 100 }];
  };
  assert.equal(await run(state, true), 1);
  assert.equal(state.active[0].version_id, '00000000-0000-0000-0000-0000000000ee');
});

test('first deploy and Durable Object lifecycle rejection use wrangler deploy', async () => {
  const first = fake(null);
  assert.equal(await run(first, true), 0);
  assert.ok(first.calls.includes('deploy --message'));

  const lifecycle = fake(OLD);
  lifecycle.uploadError = 'Durable Object migrations are not supported in versions upload (10211)';
  assert.equal(await run(lifecycle, true), 0);
  assert.equal(activeBuild(lifecycle), OURS);
});

test('other upload failures abort before publishing', async () => {
  const state = fake(OLD);
  state.uploadError = 'fetch failed: ECONNRESET';
  await assert.rejects(run(state, true), /ECONNRESET/);
  assert.equal(activeBuild(state), OLD);
  assert.ok(!state.calls.includes('deploy --message'));
});

test('status lookup errors abort before publishing', async () => {
  const state = fake(OLD);
  const base = wrangler(state);
  const broken = (args: string[]) => {
    if (args[0] === 'deployments') throw new Error('Authentication error');
    return base(args);
  };
  await assert.rejects(run(state, true, broken), /Authentication error/);
  assert.ok(!state.calls.some((call) => call.startsWith('versions')));
});

test('triggers failure rolls back like a failed verify', async () => {
  const state = fake(OLD);
  state.triggersFail = true;
  assert.equal(await run(state, true), 1);
  assert.equal(activeBuild(state), OLD);
});

test('empty watch-path match fails instead of skipping', async () => {
  const state = fake(OLD, '');
  await assert.rejects(run(state, true), /no main commit matches/);
  assert.deepEqual(state.calls, []);
});

test('triggers are applied while our version owns the Worker, even if main moved on', async () => {
  const state = fake(OLD);
  state.afterActivate = (s) => {
    s.afterActivate = undefined;
    s.head = NEWER;
  };
  assert.equal(await run(state, true), 0);
  assert.ok(state.calls.includes('triggers deploy'));
});

test('triggers are left to a replacement version', async () => {
  const state = fake(OLD);
  state.afterActivate = (s) => {
    s.afterActivate = undefined;
    s.messages['00000000-0000-0000-0000-0000000000dd'] = `build=${NEWER}`;
    s.active = [{ version_id: '00000000-0000-0000-0000-0000000000dd', percentage: 100 }];
  };
  assert.equal(await run(state, true), 0);
  assert.ok(!state.calls.includes('triggers deploy'));
});

test('multi-commit push deploys when the watched commit is an ancestor', async () => {
  const state = fake(OLD, NEWER);
  state.ancestors.push(`${NEWER}>${OURS}`);
  assert.equal(await run(state, true), 0);
  assert.equal(activeBuild(state), OURS);
});

test('rollback after applied triggers restores the predecessor triggers', async () => {
  const state = fake(OLD);
  assert.equal(await run(state, false), 1);
  assert.equal(activeBuild(state), OLD);
  assert.ok(state.calls.includes('restore prev-a.jsonc'));
});

test('rollback restores triggers from a credential-sync predecessor via its SHA tag', async () => {
  const state = fake(OLD);
  state.messages[LIVE] = 'Kanarek credential sync 1.1';
  state.tags[LIVE] = OLD.toUpperCase();
  assert.equal(await run(state, false), 1);
  assert.equal(state.active[0].version_id, LIVE);
  assert.ok(state.calls.includes('restore prev-a.jsonc'));
});

test('busy deploy lock: nothing is touched', async () => {
  const state = fake(OLD);
  const lock = fakeLock({ held: 'other', acquire: false, renewals: 0, released: [] });
  assert.equal(await run(state, true, wrangler(state), lock), 1);
  assert.deepEqual(state.calls, []);
});

test('lock is released after a deploy, also when it throws', async () => {
  const ok = fake(OLD);
  const okLock = fakeLock();
  assert.equal(await run(ok, true, wrangler(ok), okLock), 0);
  assert.equal(okLock.state.released.length, 1);

  const bad = fake(OLD);
  bad.uploadError = 'fetch failed';
  const badLock = fakeLock();
  await assert.rejects(run(bad, true, wrangler(bad), badLock), /fetch failed/);
  assert.equal(badLock.state.released.length, 1);
});

test('lost lock before activation: no activation', async () => {
  const state = fake(OLD);
  const lock = fakeLock({ held: null, acquire: true, renewals: 0, loseAfter: 0, released: [] });
  await assert.rejects(run(state, true, wrangler(state), lock), /lost deploy lock/);
  assert.equal(activeBuild(state), OLD);
  assert.ok(!state.calls.includes('versions deploy'));
});

test('d1Lock: atomic lease semantics against a fake D1', async () => {
  const rows = new Map<string, { owner: string; expires: number }>();
  let clock = 1000;
  const fakeD1 = (args: string[]) => {
    const sql = args[args.indexOf('--command') + 1];
    const insert = sql.match(/VALUES \('([^']+)', '([^']+)', (\d+)\).*expires_at < (\d+)/);
    if (insert) {
      const [, name, owner, expires, now] = insert;
      const row = rows.get(name);
      if (!row || row.expires < Number(now) || row.owner === owner) {
        rows.set(name, { owner, expires: Number(expires) });
        return JSON.stringify([{ results: [{ owner }], success: true }]);
      }
      return JSON.stringify([{ results: [], success: true }]);
    }
    const del = sql.match(/name = '([^']+)' AND owner = '([^']+)'/);
    if (del && rows.get(del[1])?.owner === del[2]) rows.delete(del[1]);
    return JSON.stringify([{ results: [], success: true }]);
  };
  const waits: number[] = [];
  const lock = d1Lock({ wrangler: fakeD1, now: () => clock, wait: async (ms: number) => { waits.push(ms); clock += ms / 1000; }, waitMs: 30_000, retryMs: 10_000 });

  assert.equal(await lock.acquire('w', 'a'), true);
  assert.equal(lock.renew('w', 'a'), true);
  assert.equal(await lock.acquire('w', 'b'), false);
  assert.equal(waits.length, 3);
  lock.release('w', 'b');
  assert.equal(rows.get('w')?.owner, 'a');
  lock.release('w', 'a');
  assert.equal(await lock.acquire('w', 'b'), true);
  clock += 16 * 60;
  assert.equal(await lock.acquire('w', 'c'), true);
  assert.equal(lock.renew('w', 'b'), false);
  assert.throws(() => lock.renew('w', "x'; DROP TABLE locks; --"), /invalid lock owner/);
});
