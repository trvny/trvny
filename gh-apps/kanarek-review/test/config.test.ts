import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { REVIEW_ROUTER_MODEL_DEFAULTS, REVIEW_ROUTER_TUNING_DEFAULTS } from '../src/review-router.ts';

const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
) as Record<string, unknown> & { vars: Record<string, string> };

test('kanarek-review stays reachable only through the Service Binding', () => {
  // The internal bearer is a public constant, so exposure is the only guard.
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  for (const key of ['route', 'routes']) {
    assert.equal(config[key], undefined, key);
  }
});

test('Workers AI is disabled outside SpaceMolt', () => {
  assert.equal(config.ai, undefined);
  assert.equal(config.vars.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'false');
});

test('review router operator defaults match wrangler.jsonc', () => {
  const defaults = { ...REVIEW_ROUTER_MODEL_DEFAULTS, ...REVIEW_ROUTER_TUNING_DEFAULTS };
  for (const [name, fallback] of Object.entries(defaults)) {
    const configured = config.vars[name];
    assert.ok(configured, `${name} missing from wrangler.jsonc`);
    assert.equal(
      Array.isArray(fallback) ? fallback.join(',') : fallback,
      configured,
      name,
    );
  }
});
