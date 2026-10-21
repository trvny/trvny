import assert from 'node:assert/strict';
import test from 'node:test';
import { readSnapshot, validateSnapshot } from './automation-baseline-preflight.mjs';

function fixture() {
  const definitions = {
    COMPANION_LOCK: 'CommentProbeLock',
    OPERATOR_CHECKPOINTS: 'OperatorCheckpointStore',
    KANAREK_REVIEW_COOLDOWNS: 'ReviewProviderCooldownStore',
    KANAREK_REVIEW_JOBS: 'WebhookReviewJob',
    ANCHOR_MUTATION_REPLAYS: 'AnchorMutationReplayStore',
  };
  const sourceBindings = Object.entries(definitions).map(([name, class_name], index) =>
    ({ type: 'durable_object_namespace', name, class_name, namespace_id: 'namespace-' + index }));
  sourceBindings.push(
    { type: 'kv_namespace', name: 'KANAREK_QUIP_KV', namespace_id: 'quip-kv' },
    { type: 'service', name: 'KANAREK_REVIEW_SERVICE', service: 'kanarek-review' },
  );
  const namespaceFor = (name) => sourceBindings.find((binding) => binding.name === name);
  const remoteDo = (name) => ({ ...namespaceFor(name), script_name: 'kanarek-companion' });
  return {
    scripts: [{ id: 'kanarek-companion' }, { id: 'gremlin' }],
    namespaces: Object.entries(definitions).map(([name, className]) => ({
      id: namespaceFor(name).namespace_id, script: 'kanarek-companion', class: className,
    })),
    sourceSettings: { bindings: sourceBindings },
    consumerSettings: {
      gremlin: { bindings: [
        { type: 'service', name: 'GPTOMEK_SIGNER', service: 'kanarek-companion' },
        remoteDo('OPERATOR_CHECKPOINTS'), remoteDo('ANCHOR_MUTATION_REPLAYS'),
      ] },
      'kanarek-review': { bindings: [remoteDo('KANAREK_REVIEW_COOLDOWNS')] },
      'tg-assistant': { bindings: [
        { type: 'service', name: 'KANAREK_COMPANION', service: 'kanarek-companion' },
        { type: 'service', name: 'BOTEK_SPECIALISTS', service: 'kanarek-companion' },
      ] },
      'pet-dispatcher-control': { bindings: [
        { type: 'service', name: 'KANAREK_COMPANION', service: 'kanarek-companion' },
      ] },
    },
    secrets: ['GITHUB_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GPTOMEK_PRIVATE_KEY',
      'GPTOMEK_WAKE_TOKEN', 'KANAREK_REVIEW_ROUTER_TOKEN'].map((name) => ({ name })),
    subdomain: { enabled: true },
    schedules: { schedules: [] },
    deployments: { deployments: [{ versions: [{ version_id: 'version-1', percentage: 100 }] }] },
  };
}

test('healthy baseline reports only counts and an explicit coverage caveat', () => {
  const result = validateSnapshot(fixture());
  assert.equal(result.status, 'PASS');
  assert.equal(result.durableObjectNamespaces, 5);
  assert.equal(result.dependentWorkers, 4);
  assert.match(result.caveat, /NOT verified/);
  assert.equal(JSON.stringify(result).includes('namespace-'), false);
});

test('refuses a target Worker that already exists', () => {
  const state = fixture();
  state.scripts.push({ id: 'automation' });
  assert.throws(() => validateSnapshot(state), /Target Worker already exists/);
});

test('detects namespace ownership and caller drift', () => {
  const state = fixture();
  state.namespaces[0].script = 'automation';
  assert.throws(() => validateSnapshot(state), /namespace count changed/);
  const consumer = fixture();
  consumer.consumerSettings.gremlin.bindings[1].namespace_id = 'fresh-namespace';
  assert.throws(() => validateSnapshot(consumer), /namespace drift/);
});

test('detects missing secret names or changed compatibility endpoints', () => {
  const state = fixture();
  state.secrets = state.secrets.filter((item) => item.name !== 'GPTOMEK_PRIVATE_KEY');
  assert.throws(() => validateSnapshot(state), /Required secret name missing/);
  const consumer = fixture();
  consumer.consumerSettings['tg-assistant'].bindings[0].service = 'automation';
  assert.throws(() => validateSnapshot(consumer), /service target changed/);
});

test('refuses missing legacy route or unexpected deployment split', () => {
  const noRoute = fixture();
  noRoute.subdomain.enabled = false;
  assert.throws(() => validateSnapshot(noRoute), /endpoint is disabled/);
  const split = fixture();
  split.deployments.deployments[0].versions[0].percentage = 50;
  assert.throws(() => validateSnapshot(split), /split across versions/);
});

test('reads real Cloudflare pagination shapes without phantom pages', async () => {
  const snapshot = fixture();
  const paths = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, 'GET');
    const parsed = new URL(url);
    paths.push(parsed.pathname + parsed.search);
    let result;
    let result_info;
    if (parsed.pathname.endsWith('/workers/scripts')) {
      result = snapshot.scripts;
    } else if (parsed.pathname.endsWith('/workers/durable_objects/namespaces')) {
      result = snapshot.namespaces;
      result_info = { page: 1, per_page: 100, count: result.length, total_count: result.length };
    } else if (parsed.pathname.endsWith('/workers/scripts/kanarek-companion/secrets')) {
      result = snapshot.secrets;
    } else if (parsed.pathname.endsWith('/workers/scripts/kanarek-companion/settings')) {
      result = snapshot.sourceSettings;
    } else if (parsed.pathname.endsWith('/workers/scripts/kanarek-companion/subdomain')) {
      result = snapshot.subdomain;
    } else if (parsed.pathname.endsWith('/workers/scripts/kanarek-companion/schedules')) {
      result = snapshot.schedules;
    } else if (parsed.pathname.endsWith('/workers/scripts/kanarek-companion/deployments')) {
      result = snapshot.deployments;
    } else {
      const match = /\/workers\/scripts\/([^/]+)\/settings$/.exec(parsed.pathname);
      assert.ok(match, 'Unexpected read-only endpoint');
      result = snapshot.consumerSettings[match[1]];
    }
    return { ok: true, json: async () => ({ success: true, result, ...(result_info ? { result_info } : {}) }) };
  };
  const live = await readSnapshot({ token: 'test-token', accountId: 'test-account', fetchImpl });
  assert.equal(validateSnapshot(live).status, 'PASS');
  assert.equal(paths.filter((path) => path.includes('/durable_objects/namespaces')).length, 1);
  assert.equal(paths.filter((path) => path.includes('/secrets')).length, 1);
  assert.equal(paths.filter((path) => path.endsWith('/scripts?page=1&per_page=100')).length, 1);
  assert.equal(paths.length, 11);
});

test('fails closed for full Cloudflare pages without pagination metadata', async () => {
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/workers/scripts')) {
      return { ok: true, json: async () => ({ success: true,
        result: Array.from({ length: 100 }, (_, index) => ({ id: 'worker-' + index })) }) };
    }
    return { ok: true, json: async () => ({ success: true, result: [] }) };
  };
  await assert.rejects(
    readSnapshot({ token: 'test-token', accountId: 'test-account', fetchImpl }),
    /full page without pagination metadata/,
  );
  assert.ok(requests < 20, 'A single full page must not trigger repeated pagination');
});
