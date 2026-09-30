import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { REVIEW_ROUTER_MODEL_DEFAULTS } from '../src/review-router.ts';

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

test('review router model fallbacks match wrangler.jsonc', () => {
  for (const [name, fallback] of Object.entries(REVIEW_ROUTER_MODEL_DEFAULTS)) {
    const configured = config.vars[name];
    assert.ok(configured, `${name} missing from wrangler.jsonc`);
    assert.equal(
      Array.isArray(fallback) ? fallback.join(',') : fallback,
      configured,
      name,
    );
  }
});
