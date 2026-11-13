import assert from 'node:assert/strict';
import { wranglerConfig } from './wrangler-config.ts';
import test from 'node:test';

import { configuredRoutingList } from '../src/review-router.ts';

const config = wranglerConfig;

const tasks = ['quip', 'review', 'judge', 'shitpost'];
const providers = ['aihubmix', 'orcarouter', 'openrouter', 'vercel'];
const decisions = ['aihubmix', 'openrouter', 'qwencloud', 'vercel'];

type OperatorRouting = {
  providerOrders: Record<string, unknown>;
  taskModels: Record<string, Record<string, unknown>>;
  decisionModels: Record<string, unknown>;
};

function assertList(value: unknown, name: string): asserts value is string[] {
  assert.ok(Array.isArray(value), name);
  assert.ok(value.length, name);
  assert.ok(value.every((item: unknown) => typeof item === 'string' && item.trim() === item && item.length > 0), name);
  assert.equal(new Set(value).size, value.length, name);
}

test('kanarek-review stays reachable only through the Service Binding', () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  for (const key of ['route', 'routes']) assert.equal(config[key], undefined, key);
});

test('Workers AI is disabled outside SpaceMolt', () => {
  assert.equal(config.ai, undefined);
  assert.equal(config.vars.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'false');
});

test('operator routing is a single structured JSON variable', () => {
  for (const name of [
    'KANAREK_REVIEW_PAID_PROVIDER_ORDER',
    'KANAREK_REVIEW_DECISION_PROVIDER_ORDER', 'KANAREK_REVIEW_ROUTER_TIMEOUT_MS',
    'KANAREK_REVIEW_WORK_TIMEOUT_MS', 'KANAREK_REVIEW_REASONING_EFFORT',
  ]) {
    assert.equal(typeof config.vars[name], 'string', name);
    assert.ok((config.vars[name] as string).trim(), name);
  }

  const routing = config.vars.KANAREK_REVIEW_ROUTING as OperatorRouting;
  assert.ok(routing && typeof routing === 'object' && !Array.isArray(routing));
  assert.ok(routing.providerOrders && routing.taskModels && routing.decisionModels);
  assertList(routing.providerOrders.general, 'general');
  assert.equal(config.vars.KANAREK_REVIEW_PROVIDER_ORDER, undefined);
  for (const task of tasks) {
    const order = routing.providerOrders[task];
    assertList(order, task);
    assert.deepEqual(configuredRoutingList(routing, 'providerOrders', task), order);
    for (const provider of providers) {
      const models = routing.taskModels[provider]?.[task];
      assertList(models, `${provider}/${task}`);
      assert.deepEqual(configuredRoutingList(routing, 'taskModels', provider, task), models);
      assert.equal(config.vars[`KANAREK_REVIEW_${provider.toUpperCase()}_${task.toUpperCase()}_MODELS`], undefined);
    }
    assert.equal(config.vars[`KANAREK_REVIEW_${task.toUpperCase()}_PROVIDER_ORDER`], undefined);
  }
  for (const provider of decisions) {
    const models = routing.decisionModels[provider];
    assertList(models, provider);
    assert.deepEqual(configuredRoutingList(routing, 'decisionModels', provider), models);
    assert.equal(config.vars[`KANAREK_REVIEW_DECISION_${provider.toUpperCase()}_MODELS`], undefined);
  }
  // Reserve at least 16 Free-plan slots for secrets and future changes.
  assert.ok(Object.keys(config.vars).length <= 48);
});

test('structured routing normalizes malformed and duplicate model preferences', () => {
  assert.deepEqual(configuredRoutingList({ taskModels: { orcarouter: { review: [' x ', 'x', '', 123, 'y'] } } }, 'taskModels', 'orcarouter', 'review'), ['x', 'y']);
  assert.equal(configuredRoutingList({ taskModels: 'invalid' }, 'taskModels', 'orcarouter', 'review'), undefined);
  assert.equal(configuredRoutingList(null, 'providerOrders', 'review'), undefined);
});

test('OpenRouter free model list stays nonempty and deduplicated', () => {
  const routing = config.vars.KANAREK_REVIEW_ROUTING as OperatorRouting;
  assert.equal(config.vars.KANAREK_REVIEW_OPENROUTER_MODELS, undefined);
  const models = routing.taskModels.openrouter.general as string[];
  assert.ok(models.length);
  assert.equal(new Set(models).size, models.length);
  for (const provider of ['aihubmix', 'orcarouter', 'openrouter', 'ollama', 'vercel']) {
    assertList(routing.taskModels[provider].general, `${provider}/general`);
    assert.equal(config.vars[`KANAREK_REVIEW_${provider.toUpperCase()}_MODELS`], undefined);
  }
});
