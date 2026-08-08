import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { hash, PRESETS, sanitize } from '../src/quip.ts';

test('keeps the refreshed Kanarek preset bank', () => {
  assert.equal(
    PRESETS.ready.includes('Czytnik mruczy, Kanarek strzyże błędy, feed płynie.'),
    true,
  );
  assert.equal(
    PRESETS.waiting.includes(
      'Kanarek śledzi CI, aż kod zabulgotuje. Testy jeszcze mieszają.',
    ),
    true,
  );
  assert.equal(
    PRESETS.blocked.includes(
      'CI in dreamland: blockers hum while Kanarek naps through the blockade.',
    ),
    true,
  );
});

test('uses the same SHA-256 quip key format as the Actions backend', async () => {
  const value = { status: 'ready', blockers: [], area: 'Repo root', size: 'tiny' };
  const expected = createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);
  assert.equal(await hash(value), expected);
});

test('sanitizes generated quips before rendering', () => {
  assert.equal(
    sanitize('**hej** @user https://example.com\nOK'),
    'hej ＠user OK',
  );
});
