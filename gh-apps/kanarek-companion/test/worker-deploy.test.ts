import assert from 'node:assert/strict';
import test from 'node:test';

import { guardedDeploy } from '../../core/worker-deploy.mjs';

const OLD = 'a'.repeat(40);
const OURS = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);
const TS: Record<string, number> = { [OLD]: 100, [OURS]: 200, [NEWER]: 300 };

type Fake = {
  active: { version_id: string; percentage: number }[];
  messages: Record<string, string>;
  calls: string[];
  uploadFails?: boolean;
  onActivate?: (fake: Fake) => void;
};

function fake(activeSha: string | null): Fake {
  const state: Fake = { active: [], messages: {}, calls: [] };
  if (activeSha) {
    state.messages['00000000-0000-0000-0000-00000000000a'] = `commit=${activeSha} ts=${TS[activeSha]}`;
    state.active = [{ version_id: '00000000-0000-0000-0000-00000000000a', percentage: 100 }];
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
      if (!state.active.length) throw new Error('The Worker x has no deployments.');
      return JSON.stringify({ versions: state.active });
    }
    if (command === 'versions view') {
      return JSON.stringify({ annotations: { 'workers/message': state.messages[args[2]] } });
    }
    if (command === 'versions upload') {
      if (state.uploadFails) throw new Error('migrations not supported');
      return `Worker Version ID: ${create()}`;
    }
    if (command === 'versions deploy') {
      state.active = args
        .filter((arg) => /^[0-9a-f-]{36}@/.test(arg))
        .map((spec) => ({ version_id: spec.split('@')[0], percentage: Number.parseInt(spec.split('@')[1], 10) }));
      state.onActivate?.(state);
      return '';
    }
    if (command === 'triggers deploy') return '';
    if (args[0] === 'deploy') {
      state.active = [{ version_id: create(), percentage: 100 }];
      return '';
    }
    throw new Error(`unexpected wrangler ${args.join(' ')}`);
  };
}

const activeSha = (state: Fake) => state.messages[state.active[0].version_id]?.match(/commit=(\w+)/)?.[1];

async function run(state: Fake, healthy: boolean | (() => boolean), sha = OURS) {
  return guardedDeploy(
    { name: 'w', sha, verify: async () => (typeof healthy === 'function' ? healthy() : healthy) },
    { wrangler: wrangler(state), commitTime: (s: string) => TS[s], wait: async () => {} },
  );
}

test('healthy deploy uploads, activates and keeps our version', async () => {
  const state = fake(OLD);
  assert.equal(await run(state, true), 0);
  assert.equal(activeSha(state), OURS);
  assert.ok(state.calls.includes('versions upload'));
  assert.ok(state.calls.includes('triggers deploy'));
});

test('superseded build skips without touching the Worker', async () => {
  const state = fake(NEWER);
  assert.equal(await run(state, true), 0);
  assert.equal(activeSha(state), NEWER);
  assert.ok(!state.calls.includes('versions upload'));
});

test('failed verify restores the predecessor while ours is active', async () => {
  const state = fake(OLD);
  assert.equal(await run(state, false), 1);
  assert.equal(activeSha(state), OLD);
});

test('failed verify never rolls back a newer build that took over', async () => {
  const state = fake(OLD);
  state.onActivate = (s) => {
    if (activeSha(s) !== OURS) return;
    s.onActivate = undefined;
    s.messages['00000000-0000-0000-0000-0000000000ff'] = `commit=${NEWER} ts=${TS[NEWER]}`;
    s.active = [{ version_id: '00000000-0000-0000-0000-0000000000ff', percentage: 100 }];
  };
  assert.equal(await run(state, false), 1);
  assert.equal(activeSha(state), NEWER);
});

test('newest build reclaims the Worker from an older late activation', async () => {
  const state = fake(OLD);
  state.onActivate = (s) => {
    if (activeSha(s) !== OURS) return;
    s.onActivate = undefined;
    s.active = [{ version_id: '00000000-0000-0000-0000-00000000000a', percentage: 100 }];
  };
  assert.equal(await run(state, true), 0);
  assert.equal(activeSha(state), OURS);
});

test('first deploy and rejected upload fall back to wrangler deploy', async () => {
  const first = fake(null);
  assert.equal(await run(first, true), 0);
  assert.ok(first.calls.includes('deploy --message'));

  const lifecycle = fake(OLD);
  lifecycle.uploadFails = true;
  assert.equal(await run(lifecycle, false), 1);
  assert.equal(activeSha(lifecycle), OURS);
});

test('status lookup errors abort before publishing', async () => {
  const state = fake(OLD);
  const broken = (args: string[]) => {
    if (args[0] === 'deployments') throw new Error('Authentication error');
    return wrangler(state)(args);
  };
  await assert.rejects(
    guardedDeploy(
      { name: 'w', sha: OURS, verify: async () => true },
      { wrangler: broken, commitTime: (s: string) => TS[s], wait: async () => {} },
    ),
    /Authentication error/,
  );
  assert.deepEqual(state.calls, []);
});

test('concurrent non-build activation (credential sync) blocks activation', async () => {
  const state = fake(OLD);
  const base = wrangler(state);
  const racing = (args: string[]) => {
    const out = base(args);
    if (args[0] === 'versions' && args[1] === 'upload') {
      state.messages['00000000-0000-0000-0000-0000000000ee'] = 'Kanarek credential sync 1.1';
      state.active = [{ version_id: '00000000-0000-0000-0000-0000000000ee', percentage: 100 }];
    }
    return out;
  };
  assert.equal(
    await guardedDeploy(
      { name: 'w', sha: OURS, verify: async () => true },
      { wrangler: racing, commitTime: (s: string) => TS[s], wait: async () => {} },
    ),
    1,
  );
  assert.equal(state.active[0].version_id, '00000000-0000-0000-0000-0000000000ee');
});
