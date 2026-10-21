#!/usr/bin/env node
// Baseline-only Cloudflare preflight. This file intentionally makes GET requests only.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'kanarek-companion';
const TARGET = 'automation';
const DO_CLASSES = Object.freeze({
  COMPANION_LOCK: 'CommentProbeLock',
  OPERATOR_CHECKPOINTS: 'OperatorCheckpointStore',
  KANAREK_REVIEW_COOLDOWNS: 'ReviewProviderCooldownStore',
  KANAREK_REVIEW_JOBS: 'WebhookReviewJob',
  ANCHOR_MUTATION_REPLAYS: 'AnchorMutationReplayStore',
});
const REQUIRED_SECRETS = [
  'GITHUB_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'GPTOMEK_PRIVATE_KEY',
  'GPTOMEK_WAKE_TOKEN',
  'KANAREK_REVIEW_ROUTER_TOKEN',
];
const CONSUMERS = Object.freeze({
  gremlin: [
    { name: 'GPTOMEK_SIGNER', type: 'service' },
    { name: 'OPERATOR_CHECKPOINTS', type: 'durable_object_namespace' },
    { name: 'ANCHOR_MUTATION_REPLAYS', type: 'durable_object_namespace' },
  ],
  'kanarek-review': [
    { name: 'KANAREK_REVIEW_COOLDOWNS', type: 'durable_object_namespace' },
  ],
  'tg-assistant': [
    { name: 'KANAREK_COMPANION', type: 'service' },
    { name: 'BOTEK_SPECIALISTS', type: 'service' },
  ],
  'pet-dispatcher-control': [
    { name: 'KANAREK_COMPANION', type: 'service' },
  ],
});

function requireState(ok, message) {
  if (!ok) throw new Error(message);
}
function bindingOf(bindings, name, type) {
  return bindings.find((binding) => binding.name === name && binding.type === type);
}

// No IDs, credentials, secret values or per-object state enter the report.
export function validateSnapshot(snapshot) {
  const scripts = snapshot.scripts;
  requireState(scripts.some((worker) => worker.id === SOURCE), 'Source Worker is missing');
  requireState(!scripts.some((worker) => worker.id === TARGET), 'Target Worker already exists: baseline preflight must be updated');
  const sourceBindings = snapshot.sourceSettings.bindings;
  const owned = snapshot.namespaces.filter((item) => item.script === SOURCE);
  const expectedClasses = Object.values(DO_CLASSES);
  requireState(owned.length === expectedClasses.length, 'Source namespace count changed');
  const ids = new Set();
  for (const [bindingName, className] of Object.entries(DO_CLASSES)) {
    const matches = owned.filter((item) => item.class === className);
    requireState(matches.length === 1 && !!matches[0].id, 'Missing or duplicate DO namespace: ' + className);
    const sourceBinding = bindingOf(sourceBindings, bindingName, 'durable_object_namespace');
    requireState(
      sourceBinding?.class_name === className && sourceBinding.namespace_id === matches[0].id,
      'Source Durable Object binding drift: ' + bindingName,
    );
    requireState(!ids.has(matches[0].id), 'Duplicate Durable Object namespace ID');
    ids.add(matches[0].id);
  }
  const quipKv = bindingOf(sourceBindings, 'KANAREK_QUIP_KV', 'kv_namespace');
  requireState(typeof quipKv?.namespace_id === 'string' && quipKv.namespace_id.length > 0, 'Quip KV binding missing');
  const reviewService = bindingOf(sourceBindings, 'KANAREK_REVIEW_SERVICE', 'service');
  requireState(reviewService?.service === 'kanarek-review', 'Private review Service Binding changed');

  for (const [workerName, specifications] of Object.entries(CONSUMERS)) {
    const bindings = snapshot.consumerSettings[workerName]?.bindings;
    requireState(Array.isArray(bindings), 'Consumer Worker settings unavailable: ' + workerName);
    for (const specification of specifications) {
      const binding = bindingOf(bindings, specification.name, specification.type);
      requireState(!!binding, 'Missing consumer binding: ' + workerName + '/' + specification.name);
      if (specification.type === 'service') {
        requireState(binding.service === SOURCE, 'Consumer service target changed: ' + workerName + '/' + specification.name);
      } else {
        const sourceBinding = bindingOf(sourceBindings, specification.name, 'durable_object_namespace');
        requireState(
          binding.script_name === SOURCE &&
          binding.class_name === sourceBinding?.class_name &&
          binding.namespace_id === sourceBinding?.namespace_id,
          'Consumer DO namespace drift: ' + workerName + '/' + specification.name,
        );
      }
    }
  }
  const names = new Set(snapshot.secrets.map((secret) => secret.name));
  for (const name of REQUIRED_SECRETS) requireState(names.has(name), 'Required secret name missing: ' + name);
  requireState(snapshot.subdomain.enabled === true, 'Legacy workers.dev endpoint is disabled');
  requireState(Array.isArray(snapshot.schedules.schedules) && snapshot.schedules.schedules.length === 0, 'Source cron schedule changed');
  const latest = snapshot.deployments.deployments?.[0];
  requireState(
    latest?.versions?.length === 1 && latest.versions[0].percentage === 100 &&
    typeof latest.versions[0].version_id === 'string',
    'Source deployment is absent or split across versions',
  );
  return {
    status: 'PASS',
    source: SOURCE,
    target: TARGET,
    durableObjectNamespaces: owned.length,
    dependentWorkers: Object.keys(CONSUMERS).length,
    secretNamesChecked: REQUIRED_SECRETS.length,
    caveat: 'GitHub App webhook URLs, Durable Object instance alarms, Workers Builds configuration and unknown external HTTP callers are NOT verified.',
  };
}

export async function readSnapshot({ token, accountId, fetchImpl = fetch }) {
  requireState(!!token && !!accountId, 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
  const root = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/workers';
  async function request(path) {
    const response = await fetchImpl(root + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Cloudflare GET failed with HTTP ' + response.status);
    const payload = await response.json();
    if (!payload.success) throw new Error('Cloudflare rejected a read-only request');
    return payload;
  }
  async function list(path) {
    const values = [];
    for (let page = 1; page <= 20; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const payload = await request(path + separator + 'page=' + page + '&per_page=100');
      requireState(Array.isArray(payload.result), 'Unexpected Cloudflare list response');
      values.push(...payload.result);
      if (!payload.result_info || page >= payload.result_info.total_pages) return values;
    }
    throw new Error('Cloudflare list exceeded 20 pages');
  }
  const [scripts, namespaces, sourceSettings, secrets, subdomain, schedules, deployments, consumerPairs] = await Promise.all([
    list('/scripts'),
    list('/durable_objects/namespaces'),
    request('/scripts/' + SOURCE + '/settings').then((value) => value.result),
    list('/scripts/' + SOURCE + '/secrets'),
    request('/scripts/' + SOURCE + '/subdomain').then((value) => value.result),
    request('/scripts/' + SOURCE + '/schedules').then((value) => value.result),
    request('/scripts/' + SOURCE + '/deployments').then((value) => value.result),
    Promise.all(Object.keys(CONSUMERS).map(async (name) =>
      [name, (await request('/scripts/' + name + '/settings')).result])),
  ]);
  return { scripts, namespaces, sourceSettings, secrets, subdomain, schedules, deployments, consumerSettings: Object.fromEntries(consumerPairs) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const snapshot = await readSnapshot({
      token: process.env.CLOUDFLARE_API_TOKEN,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    });
    console.log(JSON.stringify(validateSnapshot(snapshot), null, 2));
  } catch (error) {
    console.error('FAIL automation baseline: ' + error.message);
    process.exitCode = 1;
  }
}
