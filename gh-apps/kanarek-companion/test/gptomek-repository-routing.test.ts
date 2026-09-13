import assert from 'node:assert/strict';
import test from 'node:test';

import { gptomekRepositoryAllowed } from '../src/gptomek.ts';

test('allows GPTomek targets only in maintained owners', () => {
  assert.equal(gptomekRepositoryAllowed('trvny/feedseek'), true);
  assert.equal(gptomekRepositoryAllowed('2137x/llmbench'), true);

  assert.equal(gptomekRepositoryAllowed('someone/llmbench'), false);
  assert.equal(gptomekRepositoryAllowed('2137x/llmbench/extra'), false);
  assert.equal(gptomekRepositoryAllowed('2137x/'), false);
});
