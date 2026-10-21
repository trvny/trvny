import assert from 'node:assert/strict';
import test from 'node:test';

import { QUIP_PROMPT_SCOPE } from '../src/companion/companion-bank.ts';
import {
  paidQuipForBank,
  promptPreviousQuip,
  shouldCheckPaidReceipt,
} from '../src/companion/companion.ts';

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

test('previous quip reaches the AI prompt only from the current prompt scope', () => {
  const learned = 'Ready and calm, the branch waits politely for a merge.';
  const current = `<!-- kanarek-quip-scope:${QUIP_PROMPT_SCOPE} -->`;
  assert.equal(promptPreviousQuip(current, learned), learned);
  assert.equal(promptPreviousQuip('<!-- kanarek-quip-key:aaaaaaaaaaaaaaaa -->', learned), '');
  assert.equal(promptPreviousQuip(`<!-- kanarek-quip-scope:${QUIP_PROMPT_SCOPE - 1} -->`, learned), '');
  assert.equal(promptPreviousQuip(undefined, learned), '');
});
