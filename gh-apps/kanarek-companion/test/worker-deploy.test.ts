import assert from 'node:assert/strict';
import test from 'node:test';

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
  calls: string[];
  uploadError?: string;
  triggersFail?: boolean;
  afterUpload?: (fake: Fake) => void;
  afterActivate?: (fake: Fake) => void;
};

function fake(activeBuild: string | null, head = OURS): Fake {
  const state: Fake = { head, ancestors: [], active: [], messages: {}, calls: [] };
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
      return JSON.stringify({ annotations: { 'workers/message': state.messages[args[2]] } });
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

function run(state: Fake, healthy: boolean, runner = wrangler(state)) {
  return guardedDeploy(
    { name: 'w', sha: OURS, paths: ['gh-apps/w'], verify: async () => healthy },
    { wrangler: runner, latestCommit: () => state.head, isAncestor: (a: string, d: string) => state.ancestors.includes(`${a}>${d}`) },
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
  assert.ok(!state.calls.includes('triggers deploy'));
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

test('triggers are left to a newer build that landed after activation', async () => {
  const state = fake(OLD);
  state.afterActivate = (s) => {
    s.afterActivate = undefined;
    s.head = NEWER;
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
