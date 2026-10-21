import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSnapshot } from './automation-baseline-preflight.mjs';

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
