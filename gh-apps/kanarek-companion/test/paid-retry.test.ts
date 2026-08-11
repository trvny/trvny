import assert from 'node:assert/strict';
import test from 'node:test';

import {
  paidQuipForBank,
  shouldCheckPaidReceipt,
} from '../src/companion.ts';

const stateHash = '0123456789abcdef';
const paidQuip = 'Kanarek pilnuje zielonych lampek i spokojnie zamyka skrzynke.';

test('checks a pending receipt again for an exact-state AI comment', () => {
  assert.equal(
    shouldCheckPaidReceipt('ready', paidQuip, 'ai', stateHash, stateHash),
    true,
  );
  assert.equal(
    shouldCheckPaidReceipt(
      'ready',
      paidQuip,
      'ai',
      'fedcba9876543210',
      stateHash,
    ),
    false,
  );
  assert.equal(
    shouldCheckPaidReceipt('ready', paidQuip, 'preset', stateHash, stateHash),
    false,
  );
  assert.equal(
    shouldCheckPaidReceipt('waiting', '', 'preset', undefined, stateHash),
    false,
  );
  assert.equal(
    shouldCheckPaidReceipt('ready', '', 'preset', undefined, stateHash),
    true,
  );
});

test('same-quips-state does not suppress banking a recovered paid receipt', () => {
  assert.equal(paidQuipForBank(paidQuip, true, 'ai', paidQuip), paidQuip);
  assert.equal(paidQuipForBank(null, true, 'ai', paidQuip), null);
  assert.equal(paidQuipForBank(null, false, 'ai', paidQuip), paidQuip);
  assert.equal(paidQuipForBank(null, false, 'preset', paidQuip), null);
});
