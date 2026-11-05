import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
) as Record<string, unknown> & { vars: Record<string, string> };

const tasks = ['quip', 'review', 'judge', 'shitpost'];
const providers = ['AIHUBMIX', 'ORCAROUTER', 'OPENROUTER', 'VERCEL'];

test('kanarek-review stays reachable only through the Service Binding', () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  for (const key of ['route', 'routes']) assert.equal(config[key], undefined, key);
});

test('Workers AI is disabled outside SpaceMolt', () => {
  assert.equal(config.ai, undefined);
  assert.equal(config.vars.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'false');
});

test('operator settings and per-task routing live in wrangler.jsonc', () => {
  for (const name of [
    'KANAREK_REVIEW_PROVIDER_ORDER', 'KANAREK_REVIEW_PAID_PROVIDER_ORDER',
    'KANAREK_REVIEW_DECISION_PROVIDER_ORDER', 'KANAREK_REVIEW_ROUTER_TIMEOUT_MS',
    'KANAREK_REVIEW_WORK_TIMEOUT_MS', 'KANAREK_REVIEW_REASONING_EFFORT',
  ]) assert.ok(config.vars[name]?.trim(), name);

  for (const task of tasks) {
    const order = config.vars[`KANAREK_REVIEW_${task.toUpperCase()}_PROVIDER_ORDER`];
    assert.ok(order?.trim(), task);
    assert.equal(new Set(order.split(',')).size, order.split(',').length, task);
    for (const provider of providers) {
      const models = config.vars[`KANAREK_REVIEW_${provider}_${task.toUpperCase()}_MODELS`];
      assert.ok(models?.trim(), `${provider}/${task}`);
      assert.equal(new Set(models.split(',')).size, models.split(',').length, `${provider}/${task}`);
    }
  }
  for (const provider of ['AIHUBMIX', 'OPENROUTER', 'QWENCLOUD', 'VERCEL']) {
    assert.ok(config.vars[`KANAREK_REVIEW_DECISION_${provider}_MODELS`]?.trim(), provider);
  }
});

test('OpenRouter free model list stays nonempty and deduplicated', () => {
  const models = config.vars.KANAREK_REVIEW_OPENROUTER_MODELS?.split(',');
  assert.ok(models?.length);
  assert.equal(new Set(models).size, models.length);
});
