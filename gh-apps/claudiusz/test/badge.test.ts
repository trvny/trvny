import assert from 'node:assert/strict';
import test from 'node:test';

import { MARKER, OPT_OUT, withBadge } from '../src/badge.ts';

test('badge prepended once', () => {
  const once = withBadge('LGTM');
  assert.ok(once.startsWith(`${MARKER}\n[![Claudiusz](`));
  assert.ok(once.endsWith('\n\nLGTM'));
  assert.equal(withBadge(once), once);
});

test('foreign marker (cloud hook) is kept as is', () => {
  const cloud = `${MARKER}\n[![Claude Code](x)](y)\n\nhi`;
  assert.equal(withBadge(cloud), cloud);
});

test('opt-out strips marker only, no badge', () => {
  assert.equal(withBadge(`${OPT_OUT}\nas me`), 'as me');
  assert.equal(withBadge(`${OPT_OUT}\n    code\n`), '    code\n');
});
